import type { Ulid } from '@eduscope/shared';

/**
 * Shared TanStack Query key factories for the AI/quiz screens (S-13..S-20).
 * REST-backed reads only — WS-fed state lives in the store (selectors.ts).
 */
export const AI_KEYS = {
  countdown: ['ai', 'countdown'] as const,
  /**
   * `state` is part of the key, not just the queryFn's argument — S-13 reads
   * `draft`-only for its ready-banner count while S-14 reads the unfiltered
   * list; two different queryFns behind the same key would let TanStack Query
   * serve one screen's cached (filtered) response to the other.
   */
  questions: (sessionId: Ulid | undefined, state?: string) => ['ai', 'questions', sessionId, state ?? 'all'] as const,
  publications: (sessionId: Ulid | undefined) => ['ai', 'publications', sessionId] as const,
  leaderboard: (sessionId: Ulid | undefined) => ['ai', 'leaderboard', sessionId] as const,
  quizSession: ['quiz', 'session'] as const,
  responses: (publicationId: Ulid | undefined) => ['quiz', 'responses', publicationId] as const,
};
