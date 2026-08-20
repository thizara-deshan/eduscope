import { and, eq, inArray } from 'drizzle-orm';
import { TIMERS, type QuizPublicationPayload, type QuizResponsesPayload, type QuizSessionPayload, type QuizSessionProjection, type QuizSyncState, type RecordingStatePayload } from '@eduscope/shared';
import type { DrizzleDb } from '../../db/client.js';
import { lectureSessions, questionPublications, quizSessionProjections } from '../../db/schema.js';
import type { Clock } from '../../lib/clock.js';
import type { DomainBus, Unsubscribe } from '../../lib/domain-bus.js';
import type { IdGenerator } from '../../lib/ids.js';
import type { LifecycleComponent, LifecycleStopReason } from '../../lifecycle.js';
import type { AlertStore } from '../device/alerts.js';
import type { QuizSyncPort } from './projector.js';

const CREATE_ATTEMPTS = 3; // T-QUIZ-CREATE (8s) × 1 initial attempt + 2 retries (Z-03)
const SYNC_STALE_ALERT_CODE = 'quiz.sync-stale';
const JOINED_COUNT_COALESCE_MS = 1_000;
const NON_TERMINAL_SESSION_STATES = ['starting', 'recording', 'paused', 'stopping', 'finalizing'] as const;

type QuizSessionRow = typeof quizSessionProjections.$inferSelect;

interface QuizSessionRecord {
  lectureSessionId: string | null;
  state: QuizSessionProjection['state'];
  rowId: string | null;
  joinUrl: string | null;
  joinCode: string | null;
  joinedCount: number;
  syncState: QuizSyncState | null;
}

function freshRecord(): QuizSessionRecord {
  return { lectureSessionId: null, state: 'absent', rowId: null, joinUrl: null, joinCode: null, joinedCount: 0, syncState: null };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface QuizSessionMachineLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

export interface QuizSessionMachineDeps {
  db: DrizzleDb;
  clock: Clock;
  ids: IdGenerator;
  bus: DomainBus;
  quizSync: Pick<QuizSyncPort, 'createSession' | 'closeSession'>;
  alerts: AlertStore;
  /** G-AI-ENABLED's live seam (same one `questions.ts`/`countdown.ts` use) — `lectureSessions.aiEnabledAtStart` stays permanently false (B-05 predates the AI module, per B-31's note), so Z-01's `aiEnabledAtStart` guard reads this instead. */
  isAiEnabled: () => boolean;
  quizServerBaseUrl: () => string | null;
  deviceId: () => string;
  hallDisplayName: () => string;
  logger?: QuizSessionMachineLogger;
}

/**
 * Machine 4a (state-machines.md §5.1, Z-01..Z-06) plus machine 4d's device-side
 * half (§5.4, Z-30..Z-33): the device-side `QuizSession` projection and its
 * sync-link liveness. `QuizSessionProjection.state`/`joinCode`/`joinUrl` persist
 * (survive restart, one row per lecture session — `one_quiz_projection_per_lecture`);
 * `joinedCount`/`syncState` are live-only, like B-09's telemetry projections —
 * they reset to unknown on restart rather than retaining a stale last value.
 * `lastAnswerSeq` (the `sync.hello` watermark, B-34) is the one durable 4d field,
 * persisted directly by `responses.ts`'s `ingestAnswers`.
 */
export class QuizSessionMachine implements LifecycleComponent {
  readonly name = 'quiz-session-machine';

  readonly #deps: QuizSessionMachineDeps;
  #record: QuizSessionRecord = freshRecord();
  #unsubscribeRecording: Unsubscribe | null = null;
  #createAbort: AbortController | null = null;
  #probeTimer: { cancel(): void } | null = null;
  #staleController: AbortController | null = null;
  #failController: AbortController | null = null;
  #joinedCoalesceTimer: { cancel(): void } | null = null;
  #pendingJoinedCount: number | null = null;
  #lastJoinedPublishAtMs: number | null = null;

  constructor(deps: QuizSessionMachineDeps) {
    this.#deps = deps;
  }

  async start(): Promise<void> {
    this.#unsubscribeRecording = this.#deps.bus.subscribe('recording.state', (payload) => {
      this.#onRecordingState(payload);
    });
    this.#adoptExistingSessionAtBoot();
  }

  /**
   * Boot-time BR-1-style adoption: if a lecture session is still non-terminal
   * across a core-api restart, its `QuizSessionProjection` row (if any)
   * already exists — this in-memory record starts fresh (`freshRecord()`)
   * every boot, so without this it would re-run Z-01 and mint a second,
   * conflicting remote session the next time `recording.state{recording}`
   * re-fires (boot-recovery's own BR-1 re-publish, `executor.ts`). Adopting
   * here also means `QuizSyncStream` (registered after this component) sees
   * an already-`open` snapshot the moment its own `start()` runs.
   */
  #adoptExistingSessionAtBoot(): void {
    const active = this.#deps.db.select({ id: lectureSessions.id }).from(lectureSessions).where(inArray(lectureSessions.state, NON_TERMINAL_SESSION_STATES)).get();
    if (!active) return;
    const row = this.#deps.db.select().from(quizSessionProjections).where(eq(quizSessionProjections.lectureSessionId, active.id)).get();
    if (!row) return;
    this.#adoptRow(row);
  }

  #adoptRow(row: QuizSessionRow): void {
    this.#record.lectureSessionId = row.lectureSessionId;
    this.#record.rowId = row.id;
    this.#record.joinCode = row.joinCode;
    this.#record.joinUrl = row.joinUrl;

    if (row.state === 'open') {
      this.#record.state = 'open';
      this.#record.syncState = 'synced';
      this.#publishSession();
      this.#armSyncTimers();
      return;
    }
    if (row.state === 'requesting') {
      this.#record.state = 'requesting';
      this.#publishSession();
      void this.#attemptCreate(row.lectureSessionId);
      return;
    }
    if (row.state === 'failed') {
      this.#record.state = 'failed';
      this.#publishSession();
      this.#armProbeTimer();
    }
    // 'closed'/'absent' rows belong to a since-ended session and are not adopted (a non-terminal lecture session never owns one).
  }

  async stop(_reason: LifecycleStopReason): Promise<void> {
    this.#unsubscribeRecording?.();
    this.#unsubscribeRecording = null;
    this.#createAbort?.abort();
    this.#createAbort = null;
    this.#probeTimer?.cancel();
    this.#probeTimer = null;
    this.#cancelSyncTimers();
    this.#joinedCoalesceTimer?.cancel();
    this.#joinedCoalesceTimer = null;
  }

  /** `getQuizSession` (openapi.yaml) — `absent` when unconfigured or no session is recording (LP-18). */
  snapshot(): QuizSessionProjection {
    return {
      state: this.#record.state,
      quizSessionId: this.#record.rowId,
      lectureSessionId: this.#record.lectureSessionId,
      joinUrl: this.#record.joinUrl,
      joinCode: this.#record.joinCode,
      joinedCount: this.#record.joinedCount,
      syncState: this.#record.syncState,
    };
  }

  // ── machine 4d: sync-link activity (fed by B-34's WS stream; B-33's own tests call these directly) ──

  /** `sync.heartbeat`/`sync.answers`/`sync.participants` receipt — any inbound frame counts as activity (Z-31/Z-33). */
  recordSyncActivity(): void {
    if (this.#record.state !== 'open') return;
    const wasDegraded = this.#record.syncState === 'stale' || this.#record.syncState === 'failed';
    if (wasDegraded) {
      this.#record.syncState = 'synced';
      this.#deps.alerts.clear(SYNC_STALE_ALERT_CODE, 'resolved');
      this.#publishSession();
      this.#setOpenPublicationSyncState('synced');
    }
    this.#armSyncTimers();
  }

  /** `sync.participants` (Z-11..Z-14) — coalesced to ≤1/s (INV-G-7-style budget). */
  recordParticipants(joinedCount: number): void {
    if (this.#record.state !== 'open') return;
    this.recordSyncActivity();

    const nowMs = this.#deps.clock.now().getTime();
    if (this.#lastJoinedPublishAtMs === null || nowMs - this.#lastJoinedPublishAtMs >= JOINED_COUNT_COALESCE_MS) {
      this.#record.joinedCount = joinedCount;
      this.#lastJoinedPublishAtMs = nowMs;
      this.#publishSession();
      return;
    }
    this.#pendingJoinedCount = joinedCount;
    if (this.#joinedCoalesceTimer) return;
    const remaining = JOINED_COUNT_COALESCE_MS - (nowMs - this.#lastJoinedPublishAtMs);
    const controller = new AbortController();
    this.#deps.clock.sleep(remaining, controller.signal).then(() => {
      this.#joinedCoalesceTimer = null;
      if (this.#pendingJoinedCount === null) return;
      this.#record.joinedCount = this.#pendingJoinedCount;
      this.#pendingJoinedCount = null;
      this.#lastJoinedPublishAtMs = this.#deps.clock.now().getTime();
      this.#publishSession();
    });
    this.#joinedCoalesceTimer = { cancel: () => controller.abort() };
  }

  // ── machine 4a: Z-01..Z-06 ──────────────────────────────────────────────

  #onRecordingState(payload: RecordingStatePayload): void {
    if (payload.state === 'recording') {
      if (this.#record.state !== 'absent' || payload.sessionId === null) return;

      // Boot-recovery's BR-1 re-publishes `recording.state{recording}` (executor.ts) for a session this
      // instance's in-memory record hasn't seen yet — adopt its existing row rather than re-running Z-01
      // and minting a second, conflicting remote session (INV-QZ-1: at most one open session per lecture).
      const existing = this.#deps.db.select().from(quizSessionProjections).where(eq(quizSessionProjections.lectureSessionId, payload.sessionId)).get();
      if (existing) {
        this.#adoptRow(existing);
        return;
      }

      if (!this.#deps.isAiEnabled() || this.#deps.quizServerBaseUrl() === null) return;

      this.#record.lectureSessionId = payload.sessionId;
      this.#record.state = 'requesting';
      this.#publishSession();
      void this.#attemptCreate(payload.sessionId);
      return;
    }

    if (payload.state === 'completed' || payload.state === 'error') {
      if (this.#record.state === 'absent') return;
      this.#createAbort?.abort();
      this.#createAbort = null;
      this.#probeTimer?.cancel();
      this.#probeTimer = null;
      this.#cancelSyncTimers();
      this.#joinedCoalesceTimer?.cancel();
      this.#joinedCoalesceTimer = null;
      this.#pendingJoinedCount = null;
      this.#lastJoinedPublishAtMs = null;

      if (this.#record.state === 'open' && this.#record.rowId !== null) {
        void this.#deps.quizSync.closeSession(this.#record.rowId).catch((error: unknown) => {
          this.#deps.logger?.warn('quiz session machine: remote close-session failed', { error: describeError(error) });
        });
        const nowIso = this.#deps.clock.now().toISOString();
        this.#deps.db.update(quizSessionProjections).set({ state: 'closed', closedAt: nowIso }).where(eq(quizSessionProjections.id, this.#record.rowId)).run();
      }

      this.#record = freshRecord();
      this.#publishSession();
    }
  }

  async #attemptCreate(lectureSessionId: string): Promise<void> {
    for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt += 1) {
      if (this.#record.lectureSessionId !== lectureSessionId || this.#record.state !== 'requesting') return;
      const response = await this.#createOnce(lectureSessionId);
      if (response) {
        this.#onCreated(lectureSessionId, response);
        return;
      }
    }
    if (this.#record.lectureSessionId !== lectureSessionId || this.#record.state !== 'requesting') return;
    this.#onCreateFailed();
  }

  async #createOnce(lectureSessionId: string): Promise<{ id: string; joinCode: string; joinUrl: string; openedAt: string } | null> {
    const controller = new AbortController();
    this.#createAbort = controller;
    let settled = false;
    const raced = await new Promise<{ kind: 'ok'; value: { id: string; joinCode: string; joinUrl: string; openedAt: string } } | { kind: 'timeout' } | { kind: 'error' }>((resolve) => {
      const finish = (result: { kind: 'ok'; value: { id: string; joinCode: string; joinUrl: string; openedAt: string } } | { kind: 'timeout' } | { kind: 'error' }): void => {
        if (settled) return;
        settled = true;
        controller.abort();
        resolve(result);
      };
      this.#deps.quizSync
        .createSession({ lectureSessionId, deviceId: this.#deps.deviceId(), hallDisplayName: this.#deps.hallDisplayName() }, controller.signal)
        .then(
          (value) => finish({ kind: 'ok', value: { id: value.id, joinCode: value.joinCode, joinUrl: value.joinUrl, openedAt: value.openedAt } }),
          () => {
            if (controller.signal.aborted) return;
            finish({ kind: 'error' });
          },
        );
      this.#deps.clock.sleep(TIMERS['T-QUIZ-CREATE'], controller.signal).then(() => {
        if (controller.signal.aborted) return;
        finish({ kind: 'timeout' });
      });
    });
    if (this.#createAbort === controller) this.#createAbort = null;
    return raced.kind === 'ok' ? raced.value : null;
  }

  #onCreated(lectureSessionId: string, response: { id: string; joinCode: string; joinUrl: string; openedAt: string }): void {
    this.#deps.db
      .insert(quizSessionProjections)
      .values({
        id: response.id,
        lectureSessionId,
        deviceId: this.#deps.deviceId(),
        hallDisplayName: this.#deps.hallDisplayName(),
        joinCode: response.joinCode,
        joinUrl: response.joinUrl,
        state: 'open',
        openedAt: response.openedAt,
        closedAt: null,
      })
      .run();

    this.#record.rowId = response.id;
    this.#record.state = 'open';
    this.#record.joinCode = response.joinCode;
    this.#record.joinUrl = response.joinUrl;
    this.#record.syncState = 'synced';
    this.#publishSession();
    this.#armSyncTimers();
  }

  #onCreateFailed(): void {
    this.#record.state = 'failed';
    this.#publishSession();
    this.#deps.alerts.raise({
      code: 'quiz.unavailable',
      severity: 'warning',
      category: 'System',
      title: 'The quiz server did not respond',
      detail: `no response within ${String(TIMERS['T-QUIZ-CREATE'])}ms after retries`,
    });
    this.#armProbeTimer();
  }

  #armProbeTimer(): void {
    this.#probeTimer?.cancel();
    this.#probeTimer = this.#deps.clock.every(TIMERS['T-QUIZ-PROBE'], () => {
      if (this.#record.state !== 'failed' || this.#record.lectureSessionId === null) return;
      const lectureSessionId = this.#record.lectureSessionId;
      this.#record.state = 'requesting';
      this.#publishSession();
      void this.#attemptCreate(lectureSessionId);
    });
  }

  // ── machine 4d timers ────────────────────────────────────────────────────

  #armSyncTimers(): void {
    this.#cancelSyncTimers();
    const staleController = new AbortController();
    this.#staleController = staleController;
    this.#deps.clock.sleep(TIMERS['T-QUIZ-SYNC-STALE'], staleController.signal).then(() => {
      if (staleController.signal.aborted) return;
      this.#goStale();
    });
    const failController = new AbortController();
    this.#failController = failController;
    this.#deps.clock.sleep(TIMERS['T-QUIZ-SYNC-FAIL'], failController.signal).then(() => {
      if (failController.signal.aborted) return;
      this.#goFailed();
    });
  }

  #cancelSyncTimers(): void {
    this.#staleController?.abort();
    this.#staleController = null;
    this.#failController?.abort();
    this.#failController = null;
  }

  /** Z-30 — no answer batch or heartbeat within `T-QUIZ-SYNC-STALE`. */
  #goStale(): void {
    if (this.#record.state !== 'open' || this.#record.syncState !== 'synced') return;
    this.#record.syncState = 'stale';
    this.#publishSession();
    this.#setOpenPublicationSyncState('stale');
  }

  /** Z-32 — `T-QUIZ-SYNC-FAIL` elapsed since the last activity; recording stays untouched (QZ-7). */
  #goFailed(): void {
    if (this.#record.state !== 'open') return;
    this.#record.syncState = 'failed';
    this.#publishSession();
    this.#deps.alerts.raise({
      code: SYNC_STALE_ALERT_CODE,
      severity: 'warning',
      category: 'System',
      title: 'The quiz sync link has failed',
      detail: `no activity within ${String(TIMERS['T-QUIZ-SYNC-FAIL'])}ms`,
    });
  }

  #setOpenPublicationSyncState(syncState: QuizSyncState): void {
    if (this.#record.rowId === null) return;
    const { db } = this.#deps;
    const open = db.select().from(questionPublications).where(and(eq(questionPublications.quizSessionId, this.#record.rowId), eq(questionPublications.state, 'open'))).get();
    if (!open) return;
    db.update(questionPublications).set({ syncState }).where(eq(questionPublications.id, open.id)).run();
    this.#publishPublicationRow(open.id);
    if (syncState === 'stale') {
      const payload: QuizResponsesPayload = { publicationId: open.id, deltas: [], syncedAt: this.#deps.clock.now().toISOString(), stale: true };
      this.#deps.bus.publish('quiz.responses', payload);
    }
  }

  #publishPublicationRow(publicationId: string): void {
    const row = this.#deps.db.select().from(questionPublications).where(eq(questionPublications.id, publicationId)).get();
    if (!row) return;
    const payload: QuizPublicationPayload = {
      publicationId: row.id,
      questionId: row.questionId,
      state: row.state,
      isShowing: row.isShowing,
      projectorState: row.projectorState,
      syncState: row.syncState,
      closeReason: row.closeReason,
    };
    this.#deps.bus.publish('quiz.publication', payload);
  }

  #publishSession(): void {
    const payload: QuizSessionPayload = {
      state: this.#record.state,
      quizSessionId: this.#record.rowId,
      joinUrl: this.#record.joinUrl,
      joinCode: this.#record.joinCode,
      joinedCount: this.#record.joinedCount,
      syncState: this.#record.syncState ?? 'synced',
    };
    this.#deps.bus.publish('quiz.session', payload);
  }
}

/** Read helper for `sync.hello`'s durable `answerWatermark` (B-34) — exported so tests/callers don't reach into the row shape directly. */
export function getQuizSessionRow(db: DrizzleDb, quizSessionId: string): QuizSessionRow | undefined {
  return db.select().from(quizSessionProjections).where(eq(quizSessionProjections.id, quizSessionId)).get();
}
