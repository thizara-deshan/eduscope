import { and, eq, inArray } from 'drizzle-orm';
import { TIMERS, zQuestionUpdate, type AiQuestionPayload, type QuestionCreate } from '@eduscope/shared';
import type { z } from 'zod';
import { ProblemError } from '../../contracts/problem.js';
import type { DrizzleDb } from '../../db/client.js';
import { auditLogEntries, lectureSessions, logEntries, questionOptions, questions } from '../../db/schema.js';
import type { Clock } from '../../lib/clock.js';
import type { DomainBus } from '../../lib/domain-bus.js';
import type { IdGenerator } from '../../lib/ids.js';
import { assertAuthOwner } from '../recording/guards.js';
import type { AuthContext } from '../auth/service.js';
import { checkQuestionSetReviewed } from './question-sets.js';

const NON_TERMINAL_STATES = ['starting', 'recording', 'paused', 'stopping', 'finalizing'] as const;
/** `zQuestionUpdate`'s zod-inferred type carries explicit `| undefined` on optional fields; the generated static `QuestionUpdate` type does not, which conflicts under `exactOptionalPropertyTypes` (mirrors `helper-client.ts`'s `z.infer` pattern). */
type QuestionUpdateInput = z.infer<typeof zQuestionUpdate>;
const LABELS = ['A', 'B', 'C', 'D'] as const;

export interface QuestionsDeps {
  db: DrizzleDb;
  clock: Clock;
  ids: IdGenerator;
  bus: DomainBus;
  isAiEnabled: () => boolean;
}

export interface QuestionsAccepted {
  commandId: string;
  acceptedAt: string;
  resolveBySec: number;
}

type QuestionRow = typeof questions.$inferSelect;

function accepted(deps: Pick<QuestionsDeps, 'clock' | 'ids'>): QuestionsAccepted {
  const now = deps.clock.now();
  return { commandId: deps.ids.next(now), acceptedAt: now.toISOString(), resolveBySec: TIMERS['T-CMD-RESOLVE'] / 1000 };
}

/** The single non-terminal `LectureSession`, if any — `createQuestion` always targets it (no sessionId in the request body). */
function getActiveSession(db: DrizzleDb): { id: string; ownerUserId: string } | null {
  const row = db
    .select({ id: lectureSessions.id, ownerUserId: lectureSessions.ownerUserId })
    .from(lectureSessions)
    .where(inArray(lectureSessions.state, NON_TERMINAL_STATES))
    .get();
  return row ?? null;
}

/** INV-Q-1: an `mcq` has 2–4 options and exactly one `correctOptionId`-eligible (`isCorrect`) member. */
function assertExactlyOneCorrect(options: ReadonlyArray<{ isCorrect: boolean }>): void {
  if (options.length < 2 || options.length > 4) {
    throw new ProblemError(422, 'validation.invalid', 'A question must have 2 to 4 options');
  }
  const correctCount = options.filter((option) => option.isCorrect).length;
  if (correctCount !== 1) {
    throw new ProblemError(422, 'validation.invalid', 'Exactly one option must be marked correct');
  }
}

function publishQuestion(deps: Pick<QuestionsDeps, 'bus'>, row: QuestionRow): void {
  const payload: AiQuestionPayload = { questionId: row.id, setId: row.questionSetId, state: row.state, provenance: row.provenance, edited: row.edited };
  deps.bus.publish('ai.question', payload);
}

function currentRow(db: DrizzleDb, questionId: string): QuestionRow {
  return db.select().from(questions).where(eq(questions.id, questionId)).get()!;
}

/** Q-19 (`cmd.ai.add_question`) — always attaches to the current active session; lecturer-authored (`questionSetId = null`) outlives batches and resets (INV-Q-3). */
export function createQuestion(deps: QuestionsDeps, actor: AuthContext, input: QuestionCreate): QuestionsAccepted {
  const session = getActiveSession(deps.db);
  if (!session) throw new ProblemError(409, 'session.not-active', 'No recording is active');
  // G-AI-ENABLED (state-machines.md §0.3): checked live, the same seam `countdown.ts`'s
  // Q-01 arming and `generateNow` guard use — `lectureSessions.aiEnabledAtStart` is not
  // populated by `RecordingMachine.createStarting` (B-05 predates the AI module) and
  // stays permanently `false`, so it is not a usable signal here either.
  if (!deps.isAiEnabled()) throw new ProblemError(409, 'ai.unavailable', 'AI is not enabled for this session');
  assertAuthOwner(session, actor);
  assertExactlyOneCorrect(input.options);

  const now = deps.clock.now();
  const nowIso = now.toISOString();
  const questionId = deps.ids.next(now);
  const optionRows = input.options.map((option, index) => ({ id: deps.ids.next(now), questionId, label: LABELS[index]!, text: option.text, position: index }));
  const correctOptionId = optionRows[input.options.findIndex((option) => option.isCorrect)]!.id;

  deps.db.transaction((tx) => {
    tx.insert(questions)
      .values({
        id: questionId,
        sessionId: session.id,
        questionSetId: null,
        kind: 'mcq',
        prompt: input.prompt,
        correctOptionId: null,
        provenance: 'lecturer-authored',
        edited: false,
        state: 'draft',
        createdAt: nowIso,
        createdBy: actor.userId,
        orderHint: null,
      })
      .run();
    tx.insert(questionOptions).values(optionRows).run();
    tx.update(questions).set({ correctOptionId }).where(eq(questions.id, questionId)).run();
    tx.insert(auditLogEntries)
      .values({
        id: deps.ids.next(now),
        at: nowIso,
        actorUserId: actor.userId,
        actorKind: 'user',
        entityType: 'question',
        entityId: questionId,
        action: 'create',
        sessionId: session.id,
        before: null,
        after: { prompt: input.prompt },
        reason: null,
      })
      .run();
    tx.insert(logEntries)
      .values({
        id: deps.ids.next(now),
        at: nowIso,
        level: 'INFO',
        category: 'Session',
        service: 'core-api',
        message: 'Lecturer added a question',
        context: null,
        sessionId: session.id,
        userId: actor.userId,
      })
      .run();
  });

  publishQuestion(deps, currentRow(deps.db, questionId));
  return accepted(deps);
}

/** Q-20 (`cmd.ai.edit_question`, G-QUESTION-MUTABLE) — drafts only; `sent`/`closed` is immutable and the rejection is itself audited (INV-Q-4). */
export function editQuestion(deps: QuestionsDeps, actor: AuthContext, questionId: string, patch: QuestionUpdateInput): QuestionsAccepted {
  const row = deps.db.select().from(questions).where(eq(questions.id, questionId)).get();
  if (!row) throw new ProblemError(404, 'not-found', 'Question not found');

  const session = deps.db.select({ id: lectureSessions.id, ownerUserId: lectureSessions.ownerUserId }).from(lectureSessions).where(eq(lectureSessions.id, row.sessionId)).get()!;
  assertAuthOwner(session, actor);

  const now = deps.clock.now();
  const nowIso = now.toISOString();

  if (row.state !== 'draft') {
    deps.db
      .insert(auditLogEntries)
      .values({
        id: deps.ids.next(now),
        at: nowIso,
        actorUserId: actor.userId,
        actorKind: 'user',
        entityType: 'question',
        entityId: questionId,
        action: 'edit',
        sessionId: row.sessionId,
        before: null,
        after: null,
        reason: 'immutable',
      })
      .run();
    throw new ProblemError(409, 'question.immutable', 'A sent or closed question cannot be edited');
  }

  if (patch.options !== undefined) assertExactlyOneCorrect(patch.options);

  const existingOptions = deps.db.select().from(questionOptions).where(eq(questionOptions.questionId, questionId)).all();
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  if (patch.prompt !== undefined && patch.prompt !== row.prompt) {
    before.prompt = row.prompt;
    after.prompt = patch.prompt;
  }
  if (patch.options !== undefined) {
    before.options = existingOptions.map((option) => ({ id: option.id, text: option.text, isCorrect: option.id === row.correctOptionId }));
    after.options = patch.options;
  }
  const changed = Object.keys(after).length > 0;

  deps.db.transaction((tx) => {
    if (patch.prompt !== undefined) {
      tx.update(questions).set({ prompt: patch.prompt }).where(eq(questions.id, questionId)).run();
    }

    if (patch.options !== undefined) {
      const existingIds = new Set(existingOptions.map((option) => option.id));
      for (const entry of patch.options) {
        if (entry.id !== undefined && !existingIds.has(entry.id)) {
          throw new ProblemError(422, 'validation.invalid', 'Option id does not belong to this question');
        }
      }

      // `questions.correctOptionId` and `questionOptions.questionId` reference each other — clear it first so
      // removed option rows can be deleted without violating foreign_keys=1 (mirrors generation.ts's insert order).
      tx.update(questions).set({ correctOptionId: null }).where(eq(questions.id, questionId)).run();

      const keepIds = new Set(patch.options.map((entry) => entry.id).filter((id): id is string => id !== undefined));
      const removedIds = existingOptions.map((option) => option.id).filter((id) => !keepIds.has(id));
      if (removedIds.length > 0) {
        tx.delete(questionOptions).where(and(eq(questionOptions.questionId, questionId), inArray(questionOptions.id, removedIds))).run();
      }

      // `question_options` enforces UNIQUE(questionId, position) — reordering kept rows in place can transiently
      // collide with another kept row's still-current position, so every kept row is parked at a negative,
      // guaranteed-unused position before any row is written to its real (0-based) target position.
      existingOptions.forEach((option, index) => {
        if (keepIds.has(option.id)) {
          tx.update(questionOptions).set({ position: -1 - index }).where(eq(questionOptions.id, option.id)).run();
        }
      });

      let correctOptionId = '';
      patch.options.forEach((entry, index) => {
        const label = LABELS[index]!;
        if (entry.id !== undefined) {
          tx.update(questionOptions).set({ text: entry.text, label, position: index }).where(eq(questionOptions.id, entry.id)).run();
          if (entry.isCorrect) correctOptionId = entry.id;
        } else {
          const newId = deps.ids.next(now);
          tx.insert(questionOptions).values({ id: newId, questionId, label, text: entry.text, position: index }).run();
          if (entry.isCorrect) correctOptionId = newId;
        }
      });

      tx.update(questions).set({ correctOptionId }).where(eq(questions.id, questionId)).run();
    }

    if (changed) {
      tx.update(questions).set({ edited: true }).where(eq(questions.id, questionId)).run();
    }

    tx.insert(auditLogEntries)
      .values({
        id: deps.ids.next(now),
        at: nowIso,
        actorUserId: actor.userId,
        actorKind: 'user',
        entityType: 'question',
        entityId: questionId,
        action: 'edit',
        sessionId: row.sessionId,
        before: Object.keys(before).length > 0 ? before : null,
        after: Object.keys(after).length > 0 ? after : null,
        reason: null,
      })
      .run();
    tx.insert(logEntries)
      .values({
        id: deps.ids.next(now),
        at: nowIso,
        level: 'INFO',
        category: 'Session',
        service: 'core-api',
        message: 'Lecturer edited a question',
        context: null,
        sessionId: row.sessionId,
        userId: actor.userId,
      })
      .run();
  });

  publishQuestion(deps, currentRow(deps.db, questionId));
  return accepted(deps);
}

/** Q-21 (`cmd.ai.discard_question`) — an audited disposition, not a deletion; only a `draft` question has this transition. Q-15: discarding the last undispositioned member of a `ready` set reviews it (`question-sets.ts`'s `checkQuestionSetReviewed`). */
export function discardQuestion(deps: QuestionsDeps, actor: AuthContext, questionId: string): QuestionsAccepted {
  const row = deps.db.select().from(questions).where(eq(questions.id, questionId)).get();
  if (!row) throw new ProblemError(404, 'not-found', 'Question not found');

  const session = deps.db.select({ id: lectureSessions.id, ownerUserId: lectureSessions.ownerUserId }).from(lectureSessions).where(eq(lectureSessions.id, row.sessionId)).get()!;
  assertAuthOwner(session, actor);

  if (row.state !== 'draft') {
    throw new ProblemError(409, 'question.immutable', 'Only a draft question can be discarded');
  }

  const now = deps.clock.now();
  const nowIso = now.toISOString();

  deps.db.transaction((tx) => {
    tx.update(questions).set({ state: 'discarded' }).where(eq(questions.id, questionId)).run();
    tx.insert(auditLogEntries)
      .values({
        id: deps.ids.next(now),
        at: nowIso,
        actorUserId: actor.userId,
        actorKind: 'user',
        entityType: 'question',
        entityId: questionId,
        action: 'discard',
        sessionId: row.sessionId,
        before: { state: 'draft' },
        after: { state: 'discarded' },
        reason: null,
      })
      .run();
    tx.insert(logEntries)
      .values({
        id: deps.ids.next(now),
        at: nowIso,
        level: 'INFO',
        category: 'Session',
        service: 'core-api',
        message: 'Lecturer discarded a question',
        context: null,
        sessionId: row.sessionId,
        userId: actor.userId,
      })
      .run();
  });

  publishQuestion(deps, currentRow(deps.db, questionId));
  checkQuestionSetReviewed(deps.db, deps.bus, row.questionSetId);
  return accepted(deps);
}
