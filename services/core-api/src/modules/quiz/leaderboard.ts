import { eq } from 'drizzle-orm';
import type { Leaderboard } from '@eduscope/shared';
import { scoreQuizParticipants } from '@eduscope/shared';
import type { DrizzleDb } from '../../db/client.js';
import { answerProjections, questionPublications, questions } from '../../db/schema.js';
import type { Clock } from '../../lib/clock.js';

interface StudentAccumulator {
  studentIdNumber: string;
  displayName: string;
  answered: number;
  correct: number;
  responseMsTotal: number;
}

/**
 * LP-17 leaderboard (openapi.yaml `getLeaderboard`) — derived on every read
 * from `AnswerProjection` rows, never stored (INV-LB-1): `points = 10 ×
 * correct` (INT-2, DM-10), `accuracy = correct / answered` (0 when a student
 * has zero answers — never `NaN`), dense ranking so ties share a rank
 * (INV-LB-2). Panel-only; the projector consumer never receives this
 * (INV-LB-3, enforced by `projector.ts` never calling this function).
 */
export function getLeaderboard(db: DrizzleDb, clock: Clock, sessionId: string): Leaderboard {
  const rows = db
    .select({ answer: answerProjections, publication: questionPublications })
    .from(answerProjections)
    .innerJoin(questionPublications, eq(answerProjections.publicationId, questionPublications.id))
    .innerJoin(questions, eq(questionPublications.questionId, questions.id))
    .where(eq(questions.sessionId, sessionId))
    .all();

  const byStudent = new Map<string, StudentAccumulator>();
  let stale = false;
  for (const { answer, publication } of rows) {
    if (publication.syncState === 'stale' || publication.syncState === 'failed') stale = true;
    const accumulator = byStudent.get(answer.studentIdNumber) ?? { studentIdNumber: answer.studentIdNumber, displayName: answer.studentDisplayName, answered: 0, correct: 0, responseMsTotal: 0 };
    accumulator.displayName = answer.studentDisplayName;
    accumulator.answered += 1;
    if (answer.isCorrect) accumulator.correct += 1;
    accumulator.responseMsTotal += answer.responseTimeMs;
    byStudent.set(answer.studentIdNumber, accumulator);
  }

  const entries = scoreQuizParticipants([...byStudent.values()]);

  return { sessionId, entries, computedAt: clock.now().toISOString(), stale };
}
