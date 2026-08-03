import type { z } from 'zod';
import {
  zLeaderboard, zPublicationWithQuestion, zQuestion, zQuestionSet,
  type Leaderboard, type PublicationWithQuestion, type Question, type QuestionOption,
} from '@eduscope/shared';
import { SEED_EPOCH, SEED_LECTURE_SESSION_ID, seedId, validated } from './index.js';

/**
 * `zIntervalMinutes` is `z.unknown()` (contracts/openapi.yaml's generator
 * quirk — see rest.ts's own module comment on adapting generated names), so
 * `z.infer<typeof zQuestionSet>` types `intervalMinutesAtRequest` as
 * `unknown` where the hand-generated `QuestionSet` type says `IntervalMinutes`.
 * Seeding from the zod-inferred shape (what `validated()` actually returns)
 * avoids a spurious mismatch against the generated type.
 */
export type SeededQuestionSet = z.infer<typeof zQuestionSet>;

export interface AiSeed {
  readonly questions: Question[];
  readonly questionSets: SeededQuestionSet[];
  readonly publications: PublicationWithQuestion[];
  readonly leaderboard: Leaderboard;
}

const OPTION_LABELS = ['A', 'B', 'C', 'D'] as const;

function buildOptions(questionId: string): QuestionOption[] {
  return OPTION_LABELS.map((label, i) => ({
    id: seedId('option'),
    questionId,
    label,
    text: `Option ${label}`,
    position: i,
  }));
}

export function createAiSeed(): AiSeed {
  const setReviewed = seedId('question-set');
  const setReady = seedId('question-set');
  const quizSessionId = seedId('quiz-session');

  const questionSets = (
    [
      {
        id: setReviewed,
        trigger: 'countdown' as const,
        state: 'reviewed' as const,
        requestedAt: SEED_EPOCH,
        completedAt: SEED_EPOCH,
        requestedCount: 4,
        returnedCount: 4,
        error: null,
      },
      {
        id: setReady,
        trigger: 'manual' as const,
        state: 'ready' as const,
        requestedAt: SEED_EPOCH,
        completedAt: SEED_EPOCH,
        requestedCount: 4,
        returnedCount: 4,
        error: null,
      },
    ] as const
  ).map((row) =>
    validated(zQuestionSet, {
      ...row,
      sessionId: SEED_LECTURE_SESSION_ID,
      intervalMinutesAtRequest: 20,
    }),
  );

  const sentQuestionId = seedId('question');
  const sentOptions = buildOptions(sentQuestionId);
  const draftGeneratedId = seedId('question');
  const draftAuthoredId = seedId('question');

  const questions = [
    validated(zQuestion, {
      id: sentQuestionId,
      sessionId: SEED_LECTURE_SESSION_ID,
      questionSetId: setReviewed,
      kind: 'mcq',
      prompt: 'A binary search tree with n nodes has worst-case search time of:',
      options: sentOptions,
      correctOptionId: sentOptions[1]!.id,
      provenance: 'generated',
      edited: false,
      state: 'sent',
      createdAt: SEED_EPOCH,
      orderHint: 0,
    } satisfies Question),
    validated(zQuestion, {
      id: draftGeneratedId,
      sessionId: SEED_LECTURE_SESSION_ID,
      questionSetId: setReady,
      kind: 'mcq',
      prompt: 'Which traversal visits a node before its children?',
      options: buildOptions(draftGeneratedId),
      correctOptionId: null,
      provenance: 'generated',
      edited: false,
      state: 'draft',
      createdAt: SEED_EPOCH,
      orderHint: 0,
    } satisfies Question),
    validated(zQuestion, {
      id: draftAuthoredId,
      sessionId: SEED_LECTURE_SESSION_ID,
      questionSetId: null,
      kind: 'mcq',
      prompt: 'What is the amortized cost of a single push onto a dynamic array?',
      options: buildOptions(draftAuthoredId),
      correctOptionId: null,
      provenance: 'lecturer-authored',
      edited: false,
      state: 'draft',
      createdAt: SEED_EPOCH,
      orderHint: null,
    } satisfies Question),
  ];

  const publications = [
    validated(zPublicationWithQuestion, {
      id: seedId('publication'),
      questionId: sentQuestionId,
      quizSessionId,
      state: 'closed',
      publishedAt: SEED_EPOCH,
      closedAt: SEED_EPOCH,
      closeReason: 'lecturer-closed',
      isShowing: false,
      projectorState: 'withdrawn',
      syncState: 'synced',
      question: questions[0]!,
      responseCount: 41,
      correctCount: 27,
      incorrectCount: 14,
    } satisfies PublicationWithQuestion),
  ];

  const leaderboard = validated(zLeaderboard, {
    sessionId: SEED_LECTURE_SESSION_ID,
    entries: [
      { studentIdNumber: '210123A', displayName: 'K. Fernando', answered: 4, correct: 4, points: 40, accuracy: 1, avgResponseMs: 4200, rank: 1 },
      { studentIdNumber: '210456B', displayName: 'S. Jayasuriya', answered: 4, correct: 3, points: 30, accuracy: 0.75, avgResponseMs: 5100, rank: 2 },
      { studentIdNumber: '210789C', displayName: 'R. Wickramasinghe', answered: 3, correct: 2, points: 20, accuracy: 0.667, avgResponseMs: 6300, rank: 3 },
    ],
    computedAt: SEED_EPOCH,
    stale: false,
  } satisfies Leaderboard);

  return { questions, questionSets, publications, leaderboard };
}
