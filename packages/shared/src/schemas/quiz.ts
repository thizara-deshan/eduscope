import { z } from 'zod';
import { Instant, Ulid } from './primitives';
import {
  OptionLabel,
  PublicationCloseReason,
  QuizSessionProjectionState,
  QuizSessionState,
  QuizSyncState,
} from './enums';

/**
 * Context E (cross-zone) — quiz projections + the device↔quiz-service sync
 * contract (A-16, QZ-7, DM-P5). Everything the device holds is a projection
 * (INV-G-8): read-only, carrying syncedAt, rendered stale past its window.
 */

// ── Device-side projections (panel) ─────────────────────────────────────────

/** Machine 4a — device-side QuizSession projection. */
export const QuizSessionProjection = z.object({
  state: QuizSessionProjectionState,
  quizSessionId: Ulid.nullable(),
  lectureSessionId: Ulid.nullable(),
  joinUrl: z.string().max(256).nullable(), // encoded in the projector QR (QZ-2)
  joinCode: z.string().max(8).nullable(),
  joinedCount: z.number().int().nonnegative(),
  syncState: QuizSyncState.nullable(), // machine 4d
});
export type QuizSessionProjection = z.infer<typeof QuizSessionProjection>;

/** Device-side read model of one answer (domain model §8.10). Minimal PII (DM-14). */
export const AnswerProjection = z.object({
  id: Ulid,
  publicationId: Ulid,
  studentIdNumber: z.string().max(32),
  studentDisplayName: z.string().max(128),
  selectedOptionId: Ulid,
  isCorrect: z.boolean(),
  responseTimeMs: z.number().int().nonnegative(), // insight only, never score (INT-2)
  submittedAt: Instant,
  syncedAt: Instant, // staleness surface (QZ-7, INV-AP-2)
});
export type AnswerProjection = z.infer<typeof AnswerProjection>;

/**
 * Derived, never stored (INV-LB-1). Both sides compute rank with this shared
 * formula: points = 10 × correct (INT-2); accuracy = correct/answered, 0 when
 * answered = 0 (INV-QP-2); dense ranking, ties share a rank (INV-LB-2).
 */
export const LeaderboardEntry = z.object({
  studentIdNumber: z.string().max(32), // the key (QZ-3)
  displayName: z.string().max(128), // panel only — never projected (INV-LB-3)
  answered: z.number().int().nonnegative(),
  correct: z.number().int().nonnegative(),
  points: z.number().int().nonnegative(),
  accuracy: z.number().min(0).max(1),
  avgResponseMs: z.number().int().nonnegative(),
  rank: z.number().int().positive(),
});
export type LeaderboardEntry = z.infer<typeof LeaderboardEntry>;

export const Leaderboard = z.object({
  sessionId: Ulid,
  entries: z.array(LeaderboardEntry),
  computedAt: Instant,
  stale: z.boolean(), // machine 4d ≥ stale
});
export type Leaderboard = z.infer<typeof Leaderboard>;

// ── Device → quiz-service REST (server-to-server, DM-P5) ────────────────────
// The device is on the campus LAN and the quiz server is public: every
// connection is DEVICE-INITIATED (outbound REST + outbound WS). See
// contracts/events.md §4 for the stream half.

/** Z-01: ask quiz-service to mint a QuizSession. ULIDs are generatable on both sides (INV-G-2). */
export const QuizSessionCreateRequest = z.object({
  lectureSessionId: Ulid,
  deviceId: Ulid,
  hallDisplayName: z.string().max(128),
});
export type QuizSessionCreateRequest = z.infer<typeof QuizSessionCreateRequest>;

/** Quiz-service mints joinCode/joinUrl — it owns its URL namespace (DM-15). */
export const QuizSessionCreateResponse = z.object({
  id: Ulid,
  lectureSessionId: Ulid,
  state: QuizSessionState,
  joinCode: z.string().max(8),
  joinUrl: z.string().max(256),
  openedAt: Instant,
});
export type QuizSessionCreateResponse = z.infer<typeof QuizSessionCreateResponse>;

/**
 * sync.publication push (Q-30/Q-31). Includes correctOptionId so quiz-service
 * evaluates isCorrect at submit time (Z-22) — server-to-server only; the
 * student-facing quiz.question event NEVER carries correctness before close.
 */
export const PublicationPush = z.object({
  publicationId: Ulid,
  quizSessionId: Ulid,
  questionId: Ulid,
  prompt: z.string(),
  options: z.array(
    z.object({ id: Ulid, label: OptionLabel, text: z.string().max(512) }),
  ),
  correctOptionId: Ulid,
  publishedAt: Instant,
});
export type PublicationPush = z.infer<typeof PublicationPush>;

/** Close instruction (Q-33/Q-34/Q-35). closedAt is authoritative on both sides (INV-QPUB-4). */
export const PublicationCloseRequest = z.object({
  publicationId: Ulid,
  closedAt: Instant,
  closeReason: PublicationCloseReason,
});
export type PublicationCloseRequest = z.infer<typeof PublicationCloseRequest>;

// ── Quiz-service → device stream payloads (over the device-initiated WS) ────

/**
 * One answer record in a sync.answers batch. `seq` is the quiz-service-authored
 * per-quiz-session watermark: replay after a gap resends everything above the
 * device's watermark, idempotently (Z-31; projection rows are replaced, never
 * edited — INV-AP-1).
 */
export const AnswerSyncRecord = z.object({
  seq: z.number().int().positive(),
  answerId: Ulid,
  publicationId: Ulid,
  studentIdNumber: z.string().max(32),
  studentDisplayName: z.string().max(128),
  selectedOptionId: Ulid,
  isCorrect: z.boolean(),
  responseTimeMs: z.number().int().nonnegative(),
  submittedAt: Instant,
});
export type AnswerSyncRecord = z.infer<typeof AnswerSyncRecord>;
