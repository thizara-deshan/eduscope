import { z } from 'zod';
import { Instant, Ulid } from './primitives';
import {
  AiCountdownState,
  IntervalMinutes,
  OptionLabel,
  ProjectorState,
  PublicationCloseReason,
  PublicationState,
  QuestionKind,
  QuestionProvenance,
  QuestionSetState,
  QuestionSetTrigger,
  QuestionState,
  QuizSyncState,
} from './enums';

/** Context E (device side) — AI question flow (domain model §8.3–8.4, §8.8; machines 2a–2d). */

/** Identified, not positional — answers reference this id (DM-7, INV-Q-2). */
export const QuestionOption = z.object({
  id: Ulid,
  questionId: Ulid,
  label: OptionLabel,
  text: z.string().min(1).max(512),
  position: z.number().int().nonnegative(), // display order; editable without invalidating answers
});
export type QuestionOption = z.infer<typeof QuestionOption>;

export const Question = z.object({
  id: Ulid,
  sessionId: Ulid,
  questionSetId: Ulid.nullable(), // null = lecturer-authored; outlives batches (INV-Q-3)
  kind: QuestionKind, // V1 rejects anything but mcq (DM-12)
  prompt: z.string().min(1),
  options: z.array(QuestionOption).min(2).max(4), // INV-Q-1
  correctOptionId: Ulid.nullable(), // required for mcq; an id, never an index (INV-Q-2)
  provenance: QuestionProvenance,
  edited: z.boolean(),
  state: QuestionState, // sent/closed are immutable (INV-Q-4)
  createdAt: Instant,
  orderHint: z.number().int().nullable(),
});
export type Question = z.infer<typeof Question>;

/**
 * Create payload (Q-19, Add Question dialog). Option ids are minted by
 * core-api (INV-G-2), so correctness is flagged inline; exactly one option
 * must carry isCorrect. The STORED reference is correctOptionId (INV-Q-2).
 */
export const QuestionCreate = z
  .object({
    prompt: z.string().min(1),
    options: z
      .array(z.object({ text: z.string().min(1).max(512), isCorrect: z.boolean() }))
      .min(2)
      .max(4),
  })
  .refine((v) => v.options.filter((o) => o.isCorrect).length === 1, {
    message: 'exactly one option must be correct (INV-Q-1)',
  });
export type QuestionCreate = z.infer<typeof QuestionCreate>;

/**
 * Edit payload (Q-20) — draft questions only (G-QUESTION-MUTABLE); a sent or
 * closed question answers 409 question.immutable, and the reject is audited.
 * When `options` is present it is a full replacement: entries with an id keep
 * it, entries without get a new one.
 */
export const QuestionUpdate = z
  .object({
    prompt: z.string().min(1).optional(),
    options: z
      .array(
        z.object({
          id: Ulid.optional(),
          text: z.string().min(1).max(512),
          isCorrect: z.boolean(),
        }),
      )
      .min(2)
      .max(4)
      .optional(),
  })
  .refine(
    (v) => !v.options || v.options.filter((o) => o.isCorrect).length === 1,
    { message: 'exactly one option must be correct (INV-Q-1)' },
  );
export type QuestionUpdate = z.infer<typeof QuestionUpdate>;

/** One generation batch (domain model §8.3, machine 2b). */
export const QuestionSet = z.object({
  id: Ulid,
  sessionId: Ulid,
  trigger: QuestionSetTrigger, // manual = generateNow(), which also resets the countdown (LP-16)
  state: QuestionSetState,
  requestedAt: Instant,
  completedAt: Instant.nullable(),
  intervalMinutesAtRequest: IntervalMinutes,
  requestedCount: z.number().int().min(3).max(5), // A-14
  returnedCount: z.number().int().nonnegative().nullable(),
  error: z.string().nullable(), // visible failure with retry (J-2)
});
export type QuestionSet = z.infer<typeof QuestionSet>;

export const QuestionSetDetail = QuestionSet.extend({
  questions: z.array(Question),
});
export type QuestionSetDetail = z.infer<typeof QuestionSetDetail>;

/** REST mirror of the ai.countdown event for cold-boot rendering (machine 2a). */
export const AiCountdownSnapshot = z.object({
  state: AiCountdownState,
  remainingMs: z.number().int().nonnegative().nullable(),
  nextAt: Instant.nullable(), // panel renders the ticking display locally from nextAt
  intervalMinutes: IntervalMinutes,
});
export type AiCountdownSnapshot = z.infer<typeof AiCountdownSnapshot>;

export const SetIntervalRequest = z.object({
  intervalMinutes: IntervalMinutes, // Q-10; resets remainingMs to the new interval
});
export type SetIntervalRequest = z.infer<typeof SetIntervalRequest>;

/** The send-to-projector act and answer-acceptance window (domain model §8.8, machine 2d). */
export const QuestionPublication = z.object({
  id: Ulid,
  questionId: Ulid,
  quizSessionId: Ulid,
  state: PublicationState,
  publishedAt: Instant.nullable(), // the response-time zero point (INT-2)
  closedAt: Instant.nullable(), // authoritative for acceptance on BOTH sides (INV-QPUB-4)
  closeReason: PublicationCloseReason.nullable(),
  isShowing: z.boolean(), // exactly one true per quiz session (INV-QPUB-1)
  projectorState: ProjectorState, // Q-36 — a projector mode, not acceptance state
  syncState: QuizSyncState, // QZ-7
});
export type QuestionPublication = z.infer<typeof QuestionPublication>;

/** LP-17 Previous Questions row: publication + its question + response tallies. */
export const PublicationWithQuestion = QuestionPublication.extend({
  question: Question,
  responseCount: z.number().int().nonnegative(),
  correctCount: z.number().int().nonnegative(),
  incorrectCount: z.number().int().nonnegative(),
});
export type PublicationWithQuestion = z.infer<typeof PublicationWithQuestion>;

/** Q-36 cmd.ai.project — set-showing / withdraw. null ⇒ projector returns to slides passthrough. */
export const ProjectorRequest = z.object({
  publicationId: Ulid.nullable(),
});
export type ProjectorRequest = z.infer<typeof ProjectorRequest>;
