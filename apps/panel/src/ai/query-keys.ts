import type { Ulid } from '@eduscope/shared';

/**
 * Shared TanStack Query key factories for the AI/quiz screens (S-13..S-20).
 * REST-backed reads only — WS-fed state lives in the store (selectors.ts).
 */
export const AI_KEYS = {
  countdown: ['ai', 'countdown'] as const,
  questions: (sessionId: Ulid | undefined) => ['ai', 'questions', sessionId] as const,
  publications: (sessionId: Ulid | undefined) => ['ai', 'publications', sessionId] as const,
  leaderboard: (sessionId: Ulid | undefined) => ['ai', 'leaderboard', sessionId] as const,
  quizSession: ['quiz', 'session'] as const,
  responses: (publicationId: Ulid | undefined) => ['quiz', 'responses', publicationId] as const,
};
