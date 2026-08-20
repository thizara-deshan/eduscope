import { and, eq, inArray, ne } from 'drizzle-orm';
import { TIMERS, type PublicationCloseReason, type PublicationWithQuestion, type QuestionPublication, type QuizSessionCreateRequest, type QuizSessionCreateResponse, type RecordingStatePayload } from '@eduscope/shared';
import { ProblemError } from '../../contracts/problem.js';
import type { DrizzleDb } from '../../db/client.js';
import { answerProjections, auditLogEntries, lectureSessions, questionOptions, questionPublications, questions, questionSets, quizSessionProjections } from '../../db/schema.js';
import type { Clock } from '../../lib/clock.js';
import type { DomainBus, Unsubscribe } from '../../lib/domain-bus.js';
import type { IdGenerator } from '../../lib/ids.js';
import type { LifecycleComponent, LifecycleStopReason } from '../../lifecycle.js';
import { SerialExecutor } from '../../lib/serial-executor.js';
import type { AlertStore } from '../device/alerts.js';
import type { PipelineManagerClient } from '../recording/pm/client.js';
import { assertAuthOwner } from '../recording/guards.js';
import type { AuthContext } from '../auth/service.js';
import { checkQuestionSetReviewed, toQuestionDto } from '../ai/question-sets.js';

type PublicationRow = typeof questionPublications.$inferSelect;
type QuestionRow = typeof questions.$inferSelect;
type QuizSessionRow = typeof quizSessionProjections.$inferSelect;

const CLOSE_RETRY_DELAY_MS = 2_000;
const PROJECTOR_FAILED_ALERT_CODE = 'quiz.projector-failed';
const PUBLISH_FAILED_ALERT_CODE = 'quiz.publish-failed';

export function toPublicationDto(row: PublicationRow): QuestionPublication {
  return {
    id: row.id,
    questionId: row.questionId,
    quizSessionId: row.quizSessionId,
    state: row.state,
    publishedAt: row.publishedAt,
    closedAt: row.closedAt,
    closeReason: row.closeReason,
    isShowing: row.isShowing,
    projectorState: row.projectorState,
    syncState: row.syncState,
  };
}

/** `quizSyncPublish` request body (openapi.yaml `PublicationPush`) — the exact wire shape sent to quiz-service. */
export interface QuizPublishInput {
  publicationId: string;
  quizSessionId: string;
  questionId: string;
  prompt: string;
  options: Array<{ id: string; label: 'A' | 'B' | 'C' | 'D'; text: string }>;
  correctOptionId: string;
  publishedAt: string;
}

/** `quizSyncClosePublication` request body (openapi.yaml `PublicationCloseRequest`). */
export interface QuizClosePublicationInput {
  publicationId: string;
  closedAt: string;
  closeReason: PublicationCloseReason;
}

/**
 * The device→quiz-service half of the quiz-sync REST family (contracts/openapi.yaml
 * tag `quiz-sync`, events.md §4): `quizSyncPublish`/`quizSyncClosePublication`
 * (Q-30/31, Q-33/34/35, B-32's call sites) and `quizSyncCreateSession`/
 * `quizSyncCloseSession` (Z-01/Z-05, B-33's call site in `session.ts`) — one
 * port for the whole family since every operation shares the same deviceAuth
 * bearer/`x-eduscope-contract` mechanics. B-32/B-33 depend on this port rather
 * than a concrete client shape; `HttpQuizSyncClient` below is the real
 * implementation their own fake-server tests exercise. The provisioned device
 * credential this client sends is resolved live (nullable until B-34 wires
 * the deploy-minted static bearer, DR-03) rather than baked in at
 * construction, matching `countdown.ts`'s `llmEndpoint` seam.
 */
export interface QuizSyncPort {
  publish(input: QuizPublishInput, signal?: AbortSignal): Promise<void>;
  closePublication(input: QuizClosePublicationInput, signal?: AbortSignal): Promise<void>;
  createSession(input: QuizSessionCreateRequest, signal?: AbortSignal): Promise<QuizSessionCreateResponse>;
  closeSession(quizSessionId: string, signal?: AbortSignal): Promise<void>;
}

export interface HttpQuizSyncClientDeps {
  baseUrl: () => string | null;
  bearerToken: () => string | null;
  fetchImpl?: typeof fetch;
}

/** Real `quizSyncPublish`/`quizSyncClosePublication` wrapper — Node `fetch` only, deviceAuth bearer + `x-eduscope-contract` (DR-10), no generic HTTP client abstraction (matches `ai/clients.ts`/`pm/client.ts`). */
export class HttpQuizSyncClient implements QuizSyncPort {
  readonly #deps: HttpQuizSyncClientDeps;

  constructor(deps: HttpQuizSyncClientDeps) {
    this.#deps = deps;
  }

  async publish(input: QuizPublishInput, signal?: AbortSignal): Promise<void> {
    await this.#request('POST', '/device/v1/publications', input, signal);
  }

  async closePublication(input: QuizClosePublicationInput, signal?: AbortSignal): Promise<void> {
    await this.#request('POST', `/device/v1/publications/${input.publicationId}/close`, input, signal);
  }

  async createSession(input: QuizSessionCreateRequest, signal?: AbortSignal): Promise<QuizSessionCreateResponse> {
    return this.#request<QuizSessionCreateResponse>('POST', '/device/v1/quiz-sessions', input, signal);
  }

  async closeSession(quizSessionId: string, signal?: AbortSignal): Promise<void> {
    await this.#request('POST', `/device/v1/quiz-sessions/${quizSessionId}/close`, undefined, signal);
  }

  async #request<T = void>(method: string, path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const baseUrl = this.#deps.baseUrl();
    if (baseUrl === null) throw new Error('quiz-sync: quizServerBaseUrl is not provisioned');
    const bearer = this.#deps.bearerToken();
    const fetchImpl = this.#deps.fetchImpl ?? fetch;
    const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${bearer ?? ''}`,
        'x-eduscope-contract': '1.0',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : null,
      ...(signal !== undefined ? { signal } : {}),
    });
    if (!response.ok) {
      throw new Error(`quiz-sync: ${method} ${path} failed with status ${String(response.status)}`);
    }
    // `quizSyncPublish` (201) and `quizSyncClosePublication`/`quizSyncCloseSession` (204/idempotent) declare no
    // response body (openapi.yaml) — only `quizSyncCreateSession`'s 201 carries one, so an empty body is read as
    // text first rather than assumed-absent by status code alone.
    const text = await response.text();
    if (text.length === 0) {
      return undefined as T;
    }
    return JSON.parse(text) as T;
  }
}

export interface PublicationAccepted {
  commandId: string;
  acceptedAt: string;
  resolveBySec: number;
}

export interface PublicationOrchestratorLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

export interface PublicationOrchestratorDeps {
  db: DrizzleDb;
  clock: Clock;
  ids: IdGenerator;
  bus: DomainBus;
  pm: Pick<PipelineManagerClient, 'setProjectorConsumer'>;
  quizSync: Pick<QuizSyncPort, 'publish' | 'closePublication'>;
  alerts: AlertStore;
  isAiEnabled: () => boolean;
  logger?: PublicationOrchestratorLogger;
}

function accepted(deps: Pick<PublicationOrchestratorDeps, 'clock' | 'ids'>): PublicationAccepted {
  const now = deps.clock.now();
  return { commandId: deps.ids.next(now), acceptedAt: now.toISOString(), resolveBySec: TIMERS['T-CMD-RESOLVE'] / 1000 };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Machine 2d (state-machines.md §3.4, design/core-api.md §10): publish-before-project
 * (Q-30..Q-36). Also owns two cross-machine session-end reactions triggered by
 * `recording.state` reaching a terminal state (Q-09/R-11): closing any open
 * publication (Q-34) and reviewing/discarding this session's `QuestionSet`s
 * that Q-15 never reached (Q-17) — see `question-sets.ts`'s
 * `checkQuestionSetReviewed` for the sibling Q-15 transition this same file
 * drives from the send-to-projector path (Q-22 marks a question `sent`).
 */
export class PublicationOrchestrator implements LifecycleComponent {
  readonly name = 'quiz-publication-orchestrator';

  readonly #deps: PublicationOrchestratorDeps;
  readonly #serial = new SerialExecutor();
  #unsubscribeRecording: Unsubscribe | null = null;

  constructor(deps: PublicationOrchestratorDeps) {
    this.#deps = deps;
  }

  async start(): Promise<void> {
    this.#unsubscribeRecording = this.#deps.bus.subscribe('recording.state', (payload) => {
      if (payload.state !== 'completed' && payload.state !== 'error') return;
      void this.#serial.run(() => this.#onSessionEnded(payload)).catch((error: unknown) => {
        this.#deps.logger?.warn('quiz publication orchestrator: session-end reaction failed', { error: describeError(error) });
      });
    });
  }

  async stop(_reason: LifecycleStopReason): Promise<void> {
    this.#unsubscribeRecording?.();
    this.#unsubscribeRecording = null;
  }

  /** LP-17 — sent questions with response tallies for `sessionId` (openapi.yaml `PublicationWithQuestion`), newest first. */
  listPublications(sessionId: string): PublicationWithQuestion[] {
    const { db } = this.#deps;
    const rows = db
      .select({ publication: questionPublications, question: questions })
      .from(questionPublications)
      .innerJoin(questions, eq(questionPublications.questionId, questions.id))
      .where(eq(questions.sessionId, sessionId))
      .all();
    rows.sort((a, b) => (b.publication.publishedAt ?? '').localeCompare(a.publication.publishedAt ?? ''));

    return rows.map(({ publication, question }) => {
      const optionRows = db.select().from(questionOptions).where(eq(questionOptions.questionId, question.id)).orderBy(questionOptions.position).all();
      const answers = this.#answerTally(publication.id);
      return {
        ...toPublicationDto(publication),
        question: toQuestionDto(question, optionRows),
        responseCount: answers.responseCount,
        correctCount: answers.correctCount,
        incorrectCount: answers.incorrectCount,
      };
    });
  }

  /** Q-30 `cmd.ai.send_to_projector` — publish-before-project (DM-9, INV-QPUB-3); the projector switches only after Q-31 acks. */
  sendToProjector(actor: AuthContext, questionId: string): PublicationAccepted {
    const { db } = this.#deps;
    const question = db.select().from(questions).where(eq(questions.id, questionId)).get();
    if (!question) throw new ProblemError(404, 'not-found', 'Question not found');

    const session = this.#sessionFor(question.sessionId);
    if (!this.#deps.isAiEnabled()) throw new ProblemError(409, 'ai.unavailable', 'AI is not enabled for this session');
    assertAuthOwner(session, actor);
    if (question.state !== 'draft') throw new ProblemError(409, 'question.immutable', 'Only a draft question can be sent to the projector');
    if (question.correctOptionId === null) throw new ProblemError(409, 'conflict', 'Question has no correct option');

    const quizSession = db.select().from(quizSessionProjections).where(and(eq(quizSessionProjections.lectureSessionId, question.sessionId), eq(quizSessionProjections.state, 'open'))).get();
    if (!quizSession) throw new ProblemError(409, 'quiz.unavailable', 'No quiz session is open');

    const now = this.#deps.clock.now();
    const publicationId = this.#deps.ids.next(now);
    db.insert(questionPublications)
      .values({
        id: publicationId,
        questionId,
        quizSessionId: quizSession.id,
        state: 'publishing',
        publishedAt: null,
        closedAt: null,
        closeReason: null,
        isShowing: false,
        projectorState: 'not-shown',
        syncState: 'synced',
      })
      .run();
    this.#publishPublicationRow(publicationId);

    void this.#serial.run(() => this.#handleSend(publicationId, question, quizSession)).catch((error: unknown) => {
      this.#deps.logger?.warn('quiz publication orchestrator: send-to-projector failed', { error: describeError(error) });
    });
    return accepted(this.#deps);
  }

  /** Q-35 `cmd.ai.close_question` — `closeReason=lecturer-closed`; idempotent on an already-terminal publication. */
  closePublication(actor: AuthContext, publicationId: string): PublicationAccepted {
    const { db } = this.#deps;
    const publication = db.select().from(questionPublications).where(eq(questionPublications.id, publicationId)).get();
    if (!publication) throw new ProblemError(404, 'not-found', 'Publication not found');
    const question = db.select().from(questions).where(eq(questions.id, publication.questionId)).get()!;
    const session = this.#sessionFor(question.sessionId);
    assertAuthOwner(session, actor);

    if (publication.state === 'closed' || publication.state === 'failed') return accepted(this.#deps);
    if (publication.state !== 'open') throw new ProblemError(409, 'conflict', 'Publication is not open');

    void this.#serial.run(() => this.#closePublicationRow(publication, 'lecturer-closed', actor.userId)).catch((error: unknown) => {
      this.#deps.logger?.warn('quiz publication orchestrator: close failed', { error: describeError(error) });
    });
    return accepted(this.#deps);
  }

  /** Q-36 `cmd.ai.project` — `{publicationId}` re-projects (a `closed` publication renders in reveal mode); `{publicationId:null}` withdraws to slides passthrough. Never reopens acceptance. */
  setProjector(actor: AuthContext, publicationId: string | null): PublicationAccepted {
    const { db } = this.#deps;

    if (publicationId === null) {
      const showing = db.select().from(questionPublications).where(eq(questionPublications.projectorState, 'showing')).get();
      if (showing) {
        const question = db.select().from(questions).where(eq(questions.id, showing.questionId)).get()!;
        assertAuthOwner(this.#sessionFor(question.sessionId), actor);
      }
      void this.#serial.run(() => this.#withdrawProjector()).catch((error: unknown) => {
        this.#deps.logger?.warn('quiz publication orchestrator: withdraw failed', { error: describeError(error) });
      });
      return accepted(this.#deps);
    }

    const publication = db.select().from(questionPublications).where(eq(questionPublications.id, publicationId)).get();
    if (!publication) throw new ProblemError(404, 'not-found', 'Publication not found');
    const question = db.select().from(questions).where(eq(questions.id, publication.questionId)).get()!;
    assertAuthOwner(this.#sessionFor(question.sessionId), actor);

    void this.#serial.run(() => this.#showProjector(publication, question)).catch((error: unknown) => {
      this.#deps.logger?.warn('quiz publication orchestrator: project failed', { error: describeError(error) });
    });
    return accepted(this.#deps);
  }

  // ── Q-31/Q-32: publish, then switch the projector ──────────────────────

  async #handleSend(publicationId: string, question: QuestionRow, quizSession: QuizSessionRow): Promise<void> {
    const { db } = this.#deps;
    const options = db.select().from(questionOptions).where(eq(questionOptions.questionId, question.id)).orderBy(questionOptions.position).all();

    const previous = db
      .select()
      .from(questionPublications)
      .where(and(eq(questionPublications.quizSessionId, quizSession.id), eq(questionPublications.state, 'open')))
      .get();
    if (previous) {
      await this.#closePublicationRow(previous, 'next-question');
    }

    const now = this.#deps.clock.now();
    const publishInput: QuizPublishInput = {
      publicationId,
      quizSessionId: quizSession.id,
      questionId: question.id,
      prompt: question.prompt,
      options: options.map((option) => ({ id: option.id, label: option.label, text: option.text })),
      correctOptionId: question.correctOptionId!,
      publishedAt: now.toISOString(),
    };

    const ok = await this.#publishWithRetry(publishInput);
    if (!ok) {
      db.update(questionPublications).set({ state: 'failed' }).where(eq(questionPublications.id, publicationId)).run();
      this.#publishPublicationRow(publicationId);
      this.#deps.alerts.raise({
        code: PUBLISH_FAILED_ALERT_CODE,
        severity: 'warning',
        category: 'System',
        title: 'Publishing the question to the quiz server failed',
        detail: `no acknowledgement within ${String(TIMERS['T-PUBLISH-ACK'])}ms after retry`,
      });
      return;
    }

    db.transaction((tx) => {
      tx.update(questionPublications).set({ state: 'open', isShowing: true, publishedAt: publishInput.publishedAt }).where(eq(questionPublications.id, publicationId)).run();
      tx.update(questions).set({ state: 'sent' }).where(eq(questions.id, question.id)).run();
      tx.insert(auditLogEntries)
        .values({
          id: this.#deps.ids.next(now),
          at: publishInput.publishedAt,
          actorUserId: null,
          actorKind: 'system',
          entityType: 'question',
          entityId: question.id,
          action: 'send',
          sessionId: question.sessionId,
          before: { state: 'draft' },
          after: { state: 'sent' },
          reason: null,
        })
        .run();
    });
    this.#publishPublicationRow(publicationId);
    this.#publishQuestionRow(question);
    checkQuestionSetReviewed(db, this.#deps.bus, question.questionSetId);

    const freshQuizSession = db.select().from(quizSessionProjections).where(eq(quizSessionProjections.id, quizSession.id)).get()!;
    try {
      await this.#deps.pm.setProjectorConsumer({
        mode: 'question',
        questionPayload: {
          publicationId,
          prompt: question.prompt,
          options: options.map((option) => ({ id: option.id, label: option.label, text: option.text })),
          joinUrl: freshQuizSession.joinUrl,
          joinCode: freshQuizSession.joinCode,
        },
      });
      this.#markShowing(publicationId, quizSession.id);
    } catch (error) {
      this.#deps.logger?.warn('quiz publication orchestrator: projector switch failed', { error: describeError(error) });
      this.#deps.alerts.raise({
        code: PROJECTOR_FAILED_ALERT_CODE,
        severity: 'warning',
        category: 'System',
        title: 'Switching the projector to the question failed',
        detail: describeError(error),
      });
    }
  }

  async #publishWithRetry(input: QuizPublishInput): Promise<boolean> {
    for (let attempt = 0; attempt <= 1; attempt += 1) {
      const ok = await this.#publishOnce(input);
      if (ok) return true;
      if (attempt === 0) await this.#deps.clock.sleep(CLOSE_RETRY_DELAY_MS);
    }
    return false;
  }

  async #publishOnce(input: QuizPublishInput): Promise<boolean> {
    const controller = new AbortController();
    let settled = false;
    const raced = await new Promise<'ok' | 'timeout' | 'error'>((resolve) => {
      const finish = (result: 'ok' | 'timeout' | 'error'): void => {
        if (settled) return;
        settled = true;
        controller.abort();
        resolve(result);
      };
      this.#deps.quizSync.publish(input, controller.signal).then(
        () => finish('ok'),
        () => {
          if (controller.signal.aborted) return;
          finish('error');
        },
      );
      this.#deps.clock.sleep(TIMERS['T-PUBLISH-ACK'], controller.signal).then(() => {
        if (controller.signal.aborted) return;
        finish('timeout');
      });
    });
    return raced === 'ok';
  }

  // ── Q-33/34/35: close ────────────────────────────────────────────────────

  async #closePublicationRow(publication: PublicationRow, reason: PublicationCloseReason, actorUserId: string | null = null): Promise<void> {
    const { db } = this.#deps;
    const now = this.#deps.clock.now();
    const nowIso = now.toISOString();
    const question = db.select().from(questions).where(eq(questions.id, publication.questionId)).get()!;

    db.transaction((tx) => {
      tx.update(questionPublications).set({ state: 'closed', closedAt: nowIso, closeReason: reason, isShowing: false }).where(eq(questionPublications.id, publication.id)).run();
      tx.update(questions).set({ state: 'closed' }).where(eq(questions.id, publication.questionId)).run();
      tx.insert(auditLogEntries)
        .values({
          id: this.#deps.ids.next(now),
          at: nowIso,
          actorUserId,
          actorKind: actorUserId !== null ? 'user' : 'system',
          entityType: 'question',
          entityId: publication.questionId,
          action: 'close',
          sessionId: question.sessionId,
          before: { state: 'open' },
          after: { state: 'closed', closeReason: reason },
          reason: null,
        })
        .run();
    });
    this.#publishPublicationRow(publication.id);
    this.#publishQuestionRow({ ...question, state: 'closed' });
    checkQuestionSetReviewed(db, this.#deps.bus, question.questionSetId);

    try {
      await this.#deps.quizSync.closePublication({ publicationId: publication.id, closedAt: nowIso, closeReason: reason });
    } catch (error) {
      this.#deps.logger?.warn('quiz publication orchestrator: remote close failed', { error: describeError(error) });
    }
  }

  // ── Q-36: projector mode only ───────────────────────────────────────────

  async #showProjector(publication: PublicationRow, question: QuestionRow): Promise<void> {
    const { db } = this.#deps;
    const options = db.select().from(questionOptions).where(eq(questionOptions.questionId, question.id)).orderBy(questionOptions.position).all();
    const quizSession = db.select().from(quizSessionProjections).where(eq(quizSessionProjections.id, publication.quizSessionId)).get();
    const reveal = publication.state === 'closed';

    try {
      await this.#deps.pm.setProjectorConsumer({
        mode: 'question',
        questionPayload: {
          publicationId: publication.id,
          prompt: question.prompt,
          options: options.map((option) => ({ id: option.id, label: option.label, text: option.text })),
          joinUrl: quizSession?.joinUrl ?? null,
          joinCode: quizSession?.joinCode ?? null,
          ...(reveal && question.correctOptionId !== null ? { correctOptionId: question.correctOptionId } : {}),
        },
      });
      this.#markShowing(publication.id, publication.quizSessionId);
    } catch (error) {
      this.#deps.logger?.warn('quiz publication orchestrator: re-project failed', { error: describeError(error) });
      this.#deps.alerts.raise({
        code: PROJECTOR_FAILED_ALERT_CODE,
        severity: 'warning',
        category: 'System',
        title: 'Switching the projector failed',
        detail: describeError(error),
      });
    }
  }

  async #withdrawProjector(): Promise<void> {
    try {
      await this.#deps.pm.setProjectorConsumer({ mode: 'passthrough' });
    } catch (error) {
      this.#deps.logger?.warn('quiz publication orchestrator: withdraw failed', { error: describeError(error) });
      this.#deps.alerts.raise({
        code: PROJECTOR_FAILED_ALERT_CODE,
        severity: 'warning',
        category: 'System',
        title: 'Withdrawing the projector failed',
        detail: describeError(error),
      });
      return;
    }
    const { db } = this.#deps;
    const showing = db.select().from(questionPublications).where(eq(questionPublications.projectorState, 'showing')).all();
    for (const row of showing) {
      db.update(questionPublications).set({ projectorState: 'withdrawn' }).where(eq(questionPublications.id, row.id)).run();
      this.#publishPublicationRow(row.id);
    }
  }

  #markShowing(publicationId: string, quizSessionId: string): void {
    const { db } = this.#deps;
    db.transaction((tx) => {
      tx.update(questionPublications)
        .set({ projectorState: 'withdrawn' })
        .where(and(eq(questionPublications.quizSessionId, quizSessionId), eq(questionPublications.projectorState, 'showing'), ne(questionPublications.id, publicationId)))
        .run();
      tx.update(questionPublications).set({ projectorState: 'showing' }).where(eq(questionPublications.id, publicationId)).run();
    });
    const affected = db.select().from(questionPublications).where(eq(questionPublications.quizSessionId, quizSessionId)).all();
    for (const row of affected) this.#publishPublicationRow(row.id);
  }

  // ── Q-09/R-11 reaction: close the open publication, review/discard sets ──

  async #onSessionEnded(payload: RecordingStatePayload): Promise<void> {
    const { db, bus } = this.#deps;
    const sessionId = payload.sessionId;
    if (sessionId === null) return;

    const quizSession = db.select().from(quizSessionProjections).where(eq(quizSessionProjections.lectureSessionId, sessionId)).get();
    if (quizSession) {
      const openPublication = db.select().from(questionPublications).where(and(eq(questionPublications.quizSessionId, quizSession.id), eq(questionPublications.state, 'open'))).get();
      if (openPublication) {
        await this.#closePublicationRow(openPublication, 'session-ended');
        try {
          await this.#deps.pm.setProjectorConsumer({ mode: 'passthrough' });
          const stillShowing = db.select().from(questionPublications).where(eq(questionPublications.projectorState, 'showing')).all();
          for (const row of stillShowing) {
            db.update(questionPublications).set({ projectorState: 'withdrawn' }).where(eq(questionPublications.id, row.id)).run();
            this.#publishPublicationRow(row.id);
          }
        } catch (error) {
          this.#deps.logger?.warn('quiz publication orchestrator: session-end projector withdraw failed', { error: describeError(error) });
        }
      }
    }

    // Q-17: a `ready`/`failed` set that never reached Q-15's reviewed transition is discarded(session-ended).
    const unreviewed = db.select().from(questionSets).where(and(eq(questionSets.sessionId, sessionId), inArray(questionSets.state, ['ready', 'failed']))).all();
    for (const set of unreviewed) {
      db.update(questionSets).set({ state: 'discarded' }).where(eq(questionSets.id, set.id)).run();
      bus.publish('ai.set', { setId: set.id, sessionId, state: 'discarded', trigger: set.trigger, count: set.returnedCount, error: null, attempt: 0 });
    }
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  #sessionFor(lectureSessionId: string): { ownerUserId: string } {
    const row = this.#deps.db.select({ ownerUserId: lectureSessions.ownerUserId }).from(lectureSessions).where(eq(lectureSessions.id, lectureSessionId)).get();
    if (!row) throw new ProblemError(404, 'not-found', 'Session not found');
    return row;
  }

  /** LP-17 response/correct/incorrect tallies (openapi.yaml `PublicationWithQuestion`) — reads the `AnswerProjection` rows B-33 ingests; always zero until then. */
  #answerTally(publicationId: string): { responseCount: number; correctCount: number; incorrectCount: number } {
    const rows = this.#deps.db.select({ isCorrect: answerProjections.isCorrect }).from(answerProjections).where(eq(answerProjections.publicationId, publicationId)).all();
    const correctCount = rows.filter((row) => row.isCorrect).length;
    return { responseCount: rows.length, correctCount, incorrectCount: rows.length - correctCount };
  }

  #publishPublicationRow(publicationId: string): void {
    const row = this.#deps.db.select().from(questionPublications).where(eq(questionPublications.id, publicationId)).get();
    if (!row) return;
    this.#deps.bus.publish('quiz.publication', {
      publicationId: row.id,
      questionId: row.questionId,
      state: row.state,
      isShowing: row.isShowing,
      projectorState: row.projectorState,
      syncState: row.syncState,
      closeReason: row.closeReason,
    });
  }

  #publishQuestionRow(row: QuestionRow): void {
    this.#deps.bus.publish('ai.question', { questionId: row.id, setId: row.questionSetId, state: row.state, provenance: row.provenance, edited: row.edited });
  }
}
