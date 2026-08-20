import type { DrizzleDb } from '../../../db/client.js';
import { getQuizSessionRow } from '../session.js';

/**
 * `sync.hello`'s `answerWatermark` (events.md §4): the highest `sync.answers`
 * `seq` durably ingested for `quizSessionId` (B-33's `responses.ts` persists
 * it on `quiz_session_projections.last_answer_seq`). Read fresh on every
 * (re)connect so a restart resumes replay above the last acknowledged point
 * rather than from zero (Z-31's idempotent-recovery anchor).
 */
export function currentWatermark(db: DrizzleDb, quizSessionId: string): number {
  return getQuizSessionRow(db, quizSessionId)?.lastAnswerSeq ?? 0;
}
