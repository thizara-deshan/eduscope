import { and, asc, eq, gt } from 'drizzle-orm';
import type { QuizDb } from '../db/client.js';
import { answers, students } from '../db/schema.js';

/**
 * events.md §4 `sync.answers` row shape. Deliberately narrower than the
 * `answers` table: never `pointsAwarded`, a cookie token, or a row outside
 * `quizSessionId` — the authoritative row is server-only (D-05).
 */
export interface DeviceAnswerRow {
  seq: number;
  answerId: string;
  publicationId: string;
  studentIdNumber: string;
  studentDisplayName: string;
  selectedOptionId: string;
  isCorrect: boolean;
  responseTimeMs: number;
  submittedAt: string;
}

export const REPLAY_CHUNK_SIZE = 200;

/**
 * Reads directly from the authoritative `answers` table — there is no
 * separate outbox/replay marker (D-01 fixed decision). `seq > watermark`
 * is both the reconnect-replay query and, reused by `DeviceBatcher`, the
 * live-flush query, so replay and live delivery can never double-send or
 * drop a row (D-07 step 5).
 */
export async function replayAnswers(db: QuizDb, quizSessionId: string, watermark: number): Promise<DeviceAnswerRow[]> {
  const rows = await db
    .select({
      seq: answers.seq,
      answerId: answers.id,
      publicationId: answers.publicationId,
      studentIdNumber: students.studentIdNumber,
      studentDisplayName: students.fullName,
      selectedOptionId: answers.selectedOptionId,
      isCorrect: answers.isCorrect,
      responseTimeMs: answers.responseTimeMs,
      submittedAt: answers.submittedAt,
    })
    .from(answers)
    .innerJoin(students, eq(students.id, answers.studentId))
    .where(and(eq(answers.quizSessionId, quizSessionId), gt(answers.seq, watermark)))
    .orderBy(asc(answers.seq));

  return rows.map((row) => ({ ...row, submittedAt: row.submittedAt.toISOString() }));
}

/** Splits a replay/flush result into wire-sized frames of at most `REPLAY_CHUNK_SIZE`. */
export function chunkAnswers(rows: DeviceAnswerRow[], size: number = REPLAY_CHUNK_SIZE): DeviceAnswerRow[][] {
  const chunks: DeviceAnswerRow[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}
