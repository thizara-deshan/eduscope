import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { LLM_RETRY_BACKOFF_MS, TIMERS, type AiSetPayload } from '@eduscope/shared';
import type { DrizzleDb } from '../../db/client.js';
import { auditLogEntries, logEntries, questionOptions, questions, questionSets, slideCaptures, transcriptSegments } from '../../db/schema.js';
import type { Clock } from '../../lib/clock.js';
import type { CoreDomainEvents, DomainBus, Unsubscribe } from '../../lib/domain-bus.js';
import type { IdGenerator } from '../../lib/ids.js';
import type { LifecycleComponent, LifecycleStopReason } from '../../lifecycle.js';
import { SerialExecutor } from '../../lib/serial-executor.js';
import { AiServiceError, type QuestionClient, type QuestionGenerateResponse } from './clients.js';
import { toQuestionSetDto } from './question-sets.js';

/** ai-services.md §3, the only `promptVersions` the fixed local question-service currently declares — pinned so `question_sets.prompt_version` (NOT NULL) is known before the request, not only from its response. */
export const QUESTION_PROMPT_VERSION = 'mcq/v1';
/** A-14 — the fixed request range; `requestedCount` persists the ask (the max), `returnedCount` the actual survivor count. */
const REQUESTED_COUNT = { min: 3, max: 5 } as const;

type FailureClass = 'timeout' | 'unreachable' | 'invalid-payload';
type QuestionSetRow = typeof questionSets.$inferSelect;

export interface QuestionSetGeneratorLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

export interface QuestionSetGeneratorDeps {
  db: DrizzleDb;
  clock: Clock;
  ids: IdGenerator;
  bus: DomainBus;
  question: QuestionClient;
  /** ai-services.md §3.6 — question-service holds no config state of its own (INV-DP-3); same seam `countdown.ts`'s probe loop uses. */
  llmEndpoint: () => string | null;
  /** The B-29 seam (`countdown.ts`'s `reportGenerationSettled`) — called once a cycle settles so machine 2a can resume (Q-04) or degrade (Q-05). */
  countdown: { reportGenerationSettled(sessionId: string, outcome: 'ready' | 'failed-retryable' | 'failed-exhausted'): void };
  logger?: QuestionSetGeneratorLogger;
}

interface WindowInput {
  fromOffsetMs: number;
  toOffsetMs: number;
  transcriptText: string;
  slideCaptureIds: string[];
  slides: Array<{ offsetMs: number; ocrText: string }>;
}

interface ValidatedQuestion {
  prompt: string;
  options: Array<{ text: string; isCorrect: boolean }>;
}

function isValidGenerated(item: QuestionGenerateResponse['questions'][number]): item is ValidatedQuestion {
  if (typeof item.prompt !== 'string' || item.prompt.trim().length === 0) return false;
  if (!Array.isArray(item.options) || item.options.length < 2 || item.options.length > 4) return false;
  const correctCount = item.options.filter((option) => option.isCorrect === true).length;
  return correctCount === 1;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function classifyFailure(outcome: { kind: 'timeout' } | { kind: 'error'; error: unknown }): FailureClass {
  if (outcome.kind === 'timeout') return 'timeout';
  const { error } = outcome;
  if (error instanceof AiServiceError) {
    if (error.problem.status === 422) return 'invalid-payload';
    if (error.problem.status === 504) return 'timeout';
    return 'unreachable';
  }
  return 'unreachable';
}

const LABELS = ['A', 'B', 'C', 'D'] as const;

/**
 * Machine 2b (state-machines.md §3.2, design/core-api.md §10): consumes B-29's
 * `ai.generation.requested` (Q-02/Q-03) and drives Q-11..Q-16 — request
 * shaping, the outer `T-LLM-REQUEST` deadline, the asymmetric retry policy
 * (ai-services.md §3.6: timeout/unreachable get 2 retries before `ai.set`
 * settles with a class Q-05 recognizes; `invalid-payload` gets exactly one),
 * per-item survivor validation (INV-Q-1/INV-Q-2), and Q-16 supersession of the
 * previous `ready` set's still-`draft` generated questions (INV-Q-3 spares
 * lecturer-authored rows structurally, since only generated ones carry a
 * non-null `questionSetId`).
 */
export class QuestionSetGenerator implements LifecycleComponent {
  readonly name = 'ai-question-set-generator';

  readonly #deps: QuestionSetGeneratorDeps;
  readonly #serial = new SerialExecutor();
  #unsubscribe: Unsubscribe | null = null;
  #activeAbort: AbortController | null = null;

  constructor(deps: QuestionSetGeneratorDeps) {
    this.#deps = deps;
  }

  async start(): Promise<void> {
    this.#unsubscribe = this.#deps.bus.subscribe('ai.generation.requested', (payload) => {
      void this.#serial.run(() => this.#handleRequested(payload)).catch((error: unknown) => {
        this.#deps.logger?.warn('question set generator: cycle failed unexpectedly', { error: describeError(error) });
      });
    });
  }

  /** Aborts an in-flight question-service call; the set row is left exactly where it was persisted (`generating`) — a later boot re-arms the countdown fresh rather than resuming a stale in-flight request. */
  async stop(_reason: LifecycleStopReason): Promise<void> {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#activeAbort?.abort();
    this.#activeAbort = null;
  }

  async #handleRequested(payload: CoreDomainEvents['ai.generation.requested']): Promise<void> {
    const { sessionId, trigger } = payload;
    const now = this.#deps.clock.now();
    const setId = this.#deps.ids.next(now);
    const window = this.#computeWindow(sessionId);

    let row: QuestionSetRow = {
      id: setId,
      sessionId,
      trigger,
      state: 'generating',
      requestedAt: now.toISOString(),
      completedAt: null,
      intervalMinutesAtRequest: payload.intervalMinutesAtRequest,
      inputWindow: { fromOffsetMs: window.fromOffsetMs, toOffsetMs: window.toOffsetMs },
      slideCaptureIds: window.slideCaptureIds,
      // Provenance placeholder until the response arrives (modelId is response-only, ai-services.md §3.4) — mirrors B-12's requested/applied split for a NOT NULL column.
      modelId: '',
      promptVersion: QUESTION_PROMPT_VERSION,
      requestedCount: REQUESTED_COUNT.max,
      returnedCount: null,
      error: null,
    };
    this.#deps.db.insert(questionSets).values(row).run();
    this.#publishSet(row, 0);

    const outcome = await this.#runWithRetries(sessionId, window, setId);

    const nowFinal = this.#deps.clock.now();
    if (outcome.kind === 'ready') {
      const { row: readyRow, discardedQuestionIds } = this.#persistReady(setId, sessionId, nowFinal, outcome.response);
      row = readyRow;
      this.#publishSet(row, outcome.attempt);
      this.#publishQuestionEventsForSet(setId, 'draft');
      for (const questionId of discardedQuestionIds) {
        this.#deps.bus.publish('ai.question', { questionId, setId: null, state: 'discarded', provenance: 'generated', edited: false });
      }
      this.#deps.countdown.reportGenerationSettled(sessionId, 'ready');
      return;
    }

    row = this.#persistFailed(setId, nowFinal, outcome.error);
    this.#publishSet(row, outcome.attempt);
    this.#deps.countdown.reportGenerationSettled(sessionId, outcome.error === 'invalid-payload' ? 'failed-retryable' : 'failed-exhausted');
  }

  #computeWindow(sessionId: string): WindowInput {
    const { db } = this.#deps;
    const previousReady = db
      .select({ inputWindow: questionSets.inputWindow })
      .from(questionSets)
      .where(and(eq(questionSets.sessionId, sessionId), eq(questionSets.state, 'ready')))
      .orderBy(desc(questionSets.requestedAt))
      .get();
    const fromOffsetMs = previousReady?.inputWindow.toOffsetMs ?? 0;

    const latestSegment = db
      .select({ endOffsetMs: transcriptSegments.endOffsetMs })
      .from(transcriptSegments)
      .where(eq(transcriptSegments.sessionId, sessionId))
      .orderBy(desc(transcriptSegments.endOffsetMs))
      .get();
    const toOffsetMs = Math.max(fromOffsetMs, latestSegment?.endOffsetMs ?? fromOffsetMs);

    const segments = db
      .select({ startOffsetMs: transcriptSegments.startOffsetMs, text: transcriptSegments.text })
      .from(transcriptSegments)
      .where(and(eq(transcriptSegments.sessionId, sessionId), gte(transcriptSegments.startOffsetMs, fromOffsetMs), lte(transcriptSegments.endOffsetMs, toOffsetMs)))
      .orderBy(transcriptSegments.startOffsetMs)
      .all();
    const transcriptText = segments.map((segment) => segment.text).join(' ');

    const slides = db
      .select({ id: slideCaptures.id, offsetMs: slideCaptures.offsetMs, ocrText: slideCaptures.ocrText })
      .from(slideCaptures)
      .where(and(eq(slideCaptures.sessionId, sessionId), gte(slideCaptures.offsetMs, fromOffsetMs), lte(slideCaptures.offsetMs, toOffsetMs)))
      .orderBy(slideCaptures.offsetMs)
      .all();

    return {
      fromOffsetMs,
      toOffsetMs,
      transcriptText,
      slideCaptureIds: slides.map((slide) => slide.id),
      slides: slides.map((slide) => ({ offsetMs: slide.offsetMs, ocrText: slide.ocrText ?? '' })),
    };
  }

  async #runWithRetries(
    sessionId: string,
    window: WindowInput,
    setId: string,
  ): Promise<{ kind: 'ready'; response: QuestionGenerateResponse; attempt: number } | { kind: 'failed'; error: FailureClass; attempt: number }> {
    for (let attempt = 0; ; attempt += 1) {
      const attemptResult = await this.#attemptOnce(sessionId, window, setId);
      if (attemptResult.kind === 'ready') return { kind: 'ready', response: attemptResult.response, attempt };

      const failureClass = attemptResult.error;
      const isLastAllowedAttempt = failureClass === 'invalid-payload' ? attempt >= 1 : attempt >= LLM_RETRY_BACKOFF_MS.length;
      if (isLastAllowedAttempt) {
        return { kind: 'failed', error: failureClass, attempt };
      }

      this.#publishSet({ ...this.#currentRow(setId), state: 'generating' }, attempt + 1);
      await this.#deps.clock.sleep(LLM_RETRY_BACKOFF_MS[Math.min(attempt, LLM_RETRY_BACKOFF_MS.length - 1)]!);
    }
  }

  async #attemptOnce(sessionId: string, window: WindowInput, setId: string): Promise<{ kind: 'ready'; response: QuestionGenerateResponse } | { kind: 'failed'; error: FailureClass }> {
    const llmEndpoint = this.#deps.llmEndpoint();
    if (llmEndpoint === null) {
      return { kind: 'failed', error: 'unreachable' };
    }

    const controller = new AbortController();
    this.#activeAbort = controller;
    let settled = false;

    try {
      const raced = await new Promise<{ kind: 'ok'; value: QuestionGenerateResponse } | { kind: 'timeout' } | { kind: 'error'; error: unknown }>((resolve) => {
        const finish = (result: { kind: 'ok'; value: QuestionGenerateResponse } | { kind: 'timeout' } | { kind: 'error'; error: unknown }): void => {
          if (settled) return;
          settled = true;
          controller.abort();
          resolve(result);
        };

        this.#deps.question
          .generate(
            {
              sessionId,
              questionSetId: setId,
              count: REQUESTED_COUNT,
              transcript: { fromOffsetMs: window.fromOffsetMs, toOffsetMs: window.toOffsetMs, text: window.transcriptText },
              slides: window.slides,
              promptVersion: QUESTION_PROMPT_VERSION,
              llmEndpoint,
            },
            controller.signal,
          )
          .then(
            (value) => finish({ kind: 'ok', value }),
            (error: unknown) => {
              if (controller.signal.aborted) return;
              finish({ kind: 'error', error });
            },
          );

        this.#deps.clock.sleep(TIMERS['T-LLM-REQUEST'], controller.signal).then(() => {
          if (controller.signal.aborted) return;
          finish({ kind: 'timeout' });
        });
      });

      if (raced.kind === 'ok') {
        const survivors = raced.value.questions.filter(isValidGenerated);
        if (survivors.length === 0) return { kind: 'failed', error: 'invalid-payload' };
        return { kind: 'ready', response: { ...raced.value, questions: survivors } };
      }
      return { kind: 'failed', error: classifyFailure(raced) };
    } finally {
      if (this.#activeAbort === controller) this.#activeAbort = null;
    }
  }

  #currentRow(setId: string): QuestionSetRow {
    return this.#deps.db.select().from(questionSets).where(eq(questionSets.id, setId)).get()!;
  }

  #persistReady(setId: string, sessionId: string, now: Date, response: QuestionGenerateResponse): { row: QuestionSetRow; discardedQuestionIds: string[] } {
    const { db, ids } = this.#deps;
    const nowIso = now.toISOString();
    let discardedQuestionIds: string[] = [];

    db.transaction((tx) => {
      tx.update(questionSets)
        .set({ state: 'ready', completedAt: nowIso, modelId: response.modelId ?? 'unknown', promptVersion: response.promptVersion, returnedCount: response.questions.length })
        .where(eq(questionSets.id, setId))
        .run();

      for (const generated of response.questions) {
        const questionId = ids.next(now);
        const correctIndex = generated.options.findIndex((option) => option.isCorrect);
        const optionRows = generated.options.map((option, index) => ({
          id: ids.next(now),
          questionId,
          label: LABELS[index]!,
          text: option.text,
          position: index,
        }));
        const correctOptionId = optionRows[correctIndex]!.id;

        // `questions.correctOptionId` and `questionOptions.questionId` reference each other,
        // so the question row is created with correctOptionId null, the options inserted
        // against its now-existing id, then correctOptionId backfilled (foreign_keys=1 checks each statement).
        tx.insert(questions)
          .values({
            id: questionId,
            sessionId,
            questionSetId: setId,
            kind: 'mcq',
            prompt: generated.prompt,
            correctOptionId: null,
            provenance: 'generated',
            edited: false,
            state: 'draft',
            createdAt: nowIso,
            createdBy: null,
            orderHint: null,
          })
          .run();
        tx.insert(questionOptions).values(optionRows).run();
        tx.update(questions).set({ correctOptionId }).where(eq(questions.id, questionId)).run();
        tx.insert(auditLogEntries)
          .values({
            id: ids.next(now),
            at: nowIso,
            actorUserId: null,
            actorKind: 'system',
            entityType: 'question',
            entityId: questionId,
            action: 'create',
            sessionId,
            before: null,
            after: { prompt: generated.prompt, modelId: response.modelId, promptVersion: response.promptVersion },
            reason: null,
          })
          .run();
      }

      tx.insert(logEntries)
        .values({
          id: ids.next(now),
          at: nowIso,
          level: 'INFO',
          category: 'Session',
          service: 'ai',
          message: `Question set ready: ${String(response.questions.length)} question(s)`,
          context: { subservice: 'question' },
          sessionId,
        })
        .run();

      // Q-16: supersede any other ready set for this session, sparing lecturer-authored rows (questionSetId = null are structurally excluded).
      const previousReady = tx
        .select()
        .from(questionSets)
        .where(and(eq(questionSets.sessionId, sessionId), eq(questionSets.state, 'ready')))
        .all()
        .filter((candidate) => candidate.id !== setId);

      for (const previous of previousReady) {
        tx.update(questionSets).set({ state: 'discarded' }).where(eq(questionSets.id, previous.id)).run();
        const draftQuestions = tx
          .select()
          .from(questions)
          .where(and(eq(questions.questionSetId, previous.id), eq(questions.state, 'draft')))
          .all();
        for (const draft of draftQuestions) {
          tx.update(questions).set({ state: 'discarded' }).where(eq(questions.id, draft.id)).run();
          tx.insert(auditLogEntries)
            .values({
              id: ids.next(now),
              at: nowIso,
              actorUserId: null,
              actorKind: 'system',
              entityType: 'question',
              entityId: draft.id,
              action: 'discard',
              sessionId,
              before: { state: 'draft' },
              after: { state: 'discarded' },
              reason: 'superseded',
            })
            .run();
        }
        discardedQuestionIds = [...discardedQuestionIds, ...draftQuestions.map((draft) => draft.id)];
      }
    });

    return { row: this.#currentRow(setId), discardedQuestionIds };
  }

  #publishQuestionEventsForSet(setId: string, state: 'draft'): void {
    const rows = this.#deps.db.select().from(questions).where(and(eq(questions.questionSetId, setId), eq(questions.state, state))).all();
    for (const row of rows) {
      this.#deps.bus.publish('ai.question', { questionId: row.id, setId: row.questionSetId, state: row.state, provenance: row.provenance, edited: row.edited });
    }
  }

  #persistFailed(setId: string, now: Date, error: FailureClass): QuestionSetRow {
    const nowIso = now.toISOString();
    this.#deps.db.update(questionSets).set({ state: 'failed', completedAt: nowIso, error }).where(eq(questionSets.id, setId)).run();
    return this.#currentRow(setId);
  }

  #publishSet(row: QuestionSetRow, attempt: number): void {
    const dto = toQuestionSetDto(row);
    const payload: AiSetPayload = {
      setId: dto.id,
      sessionId: dto.sessionId,
      state: dto.state,
      trigger: dto.trigger,
      count: dto.returnedCount,
      error: (dto.error as FailureClass | null) ?? null,
      attempt,
    };
    this.#deps.bus.publish('ai.set', payload);
  }
}
