import { and, eq, sql } from 'drizzle-orm';
import type {
  StudentQuizOption,
  StudentQuizQuestionPayload,
  StudentQuizResultPayload,
  StudentQuizSessionPayload,
} from '@eduscope/shared';
import { scoreQuizParticipants, type QuizScoreInput, type ScoredQuizParticipant } from '@eduscope/shared';
import type { QuizDb } from '../db/client.js';
import { answers, participants, publications, students, type StoredQuizOption } from '../db/schema.js';

/** The one student-facing row shape both `snapshot.ts` and `stream.ts` build from — never a raw DB row. */
export interface CurrentPublicationRow {
  id: string;
  prompt: string;
  options: StoredQuizOption[];
  correctOptionId: string;
  state: 'open' | 'closed';
}

interface OwnAnswer {
  selectedOptionId: string;
  isCorrect: boolean;
  pointsAwarded: number;
}

export function toCurrentPublicationRow(row: typeof publications.$inferSelect): CurrentPublicationRow {
  return {
    id: row.id,
    prompt: row.prompt,
    options: row.options,
    correctOptionId: row.correctOptionId,
    state: row.state as 'open' | 'closed',
  };
}

function toStudentOptions(options: StoredQuizOption[]): StudentQuizOption[] {
  return options.map((option) => ({ id: option.id, label: option.label, text: option.text }));
}

/** events.md §5.2 — an open/closed question never carries `correctOptionId` or another participant's data. */
export function serializeQuestion(
  publication: CurrentPublicationRow | undefined,
  ownAnswerOptionId: string | null,
): StudentQuizQuestionPayload {
  if (!publication) return { state: 'none' };
  return {
    state: publication.state,
    publicationId: publication.id,
    prompt: publication.prompt,
    options: toStudentOptions(publication.options),
    ownAnswerOptionId,
  };
}

/**
 * DM-10 standings for every participant of `quizSessionId`, scored only from
 * answers on *closed* publications (INV-AP-2/privacy: an answer stored
 * against a still-open publication never leaks correctness or moves a
 * runningScore/rank before its own publication closes). Every participant is
 * represented even with zero closed-publication answers, so dense ranking
 * (ties share a rank) accounts for the whole session, not just answerers.
 */
async function sessionStandings(db: QuizDb, quizSessionId: string): Promise<ScoredQuizParticipant[]> {
  const rows = await db
    .select({
      studentIdNumber: students.studentIdNumber,
      fullName: students.fullName,
      answered: sql<number>`count(${answers.id})::int`,
      correct: sql<number>`count(${answers.id}) filter (where ${answers.isCorrect})::int`,
      responseMsTotal: sql<number>`coalesce(sum(${answers.responseTimeMs}), 0)::int`,
    })
    .from(participants)
    .innerJoin(students, eq(students.id, participants.studentId))
    .leftJoin(
      publications,
      and(eq(publications.quizSessionId, participants.quizSessionId), eq(publications.state, 'closed')),
    )
    .leftJoin(answers, and(eq(answers.publicationId, publications.id), eq(answers.studentId, participants.studentId)))
    .where(eq(participants.quizSessionId, quizSessionId))
    .groupBy(students.studentIdNumber, students.fullName);

  const inputs: QuizScoreInput[] = rows.map((row) => ({
    studentIdNumber: row.studentIdNumber,
    displayName: row.fullName,
    answered: row.answered,
    correct: row.correct,
    responseMsTotal: row.responseMsTotal,
  }));
  return scoreQuizParticipants(inputs);
}

/** events.md §5.3 — own-result only; self-contained after cold connect/reload. */
export async function serializeResult(
  db: QuizDb,
  quizSessionId: string,
  studentIdNumber: string,
  publication: CurrentPublicationRow,
  ownAnswer: OwnAnswer | undefined,
): Promise<StudentQuizResultPayload> {
  const standings = await sessionStandings(db, quizSessionId);
  const own = standings.find((row) => row.studentIdNumber === studentIdNumber);

  return {
    publicationId: publication.id,
    question: { prompt: publication.prompt, options: toStudentOptions(publication.options) },
    selectedOptionId: ownAnswer?.selectedOptionId ?? null,
    isCorrect: ownAnswer?.isCorrect ?? null,
    correctOptionId: publication.correctOptionId,
    pointsAwarded: ownAnswer?.pointsAwarded ?? 0,
    runningScore: own?.points ?? 0,
    ownRank: own?.rank ?? null,
    rankState: 'current',
  };
}

/** events.md §5.5 — the terminal payload contains only the current participant's summary. */
export async function serializeSessionTerminal(
  db: QuizDb,
  quizSessionId: string,
  studentIdNumber: string,
): Promise<StudentQuizSessionPayload> {
  const standings = await sessionStandings(db, quizSessionId);
  const own = standings.find((row) => row.studentIdNumber === studentIdNumber);

  if (!own || own.answered === 0) {
    return { state: 'closed', participationState: 'none', finalScore: 0, finalRank: null, answeredCount: 0 };
  }
  return {
    state: 'closed',
    participationState: 'participated',
    finalScore: own.points,
    finalRank: own.rank,
    answeredCount: own.answered,
  };
}

/** events.md §5.4 — a snapshot only ever exists for an actively attached socket, so the cookie-authenticated participant is always online at that instant. */
export function serializeParticipant(): { connectionState: 'online' } {
  return { connectionState: 'online' };
}
