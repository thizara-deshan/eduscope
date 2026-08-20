import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Question, QuestionOption, QuestionSet, QuestionSetDetail, QuestionState } from '@eduscope/shared';
import type { DrizzleDb } from '../../db/client.js';
import { questionOptions, questions, questionSets } from '../../db/schema.js';

type QuestionSetRow = typeof questionSets.$inferSelect;
type QuestionRow = typeof questions.$inferSelect;
type QuestionOptionRow = typeof questionOptions.$inferSelect;

/** openapi.yaml `QuestionSet` — machine 2b's public projection (no `modelId`/`promptVersion`; those stay internal provenance, domain-model.md §8.3). */
export function toQuestionSetDto(row: QuestionSetRow): QuestionSet {
  return {
    id: row.id,
    sessionId: row.sessionId,
    trigger: row.trigger,
    state: row.state,
    requestedAt: row.requestedAt,
    completedAt: row.completedAt,
    intervalMinutesAtRequest: row.intervalMinutesAtRequest,
    requestedCount: row.requestedCount,
    returnedCount: row.returnedCount,
    error: row.error,
  };
}

function toQuestionOptionDto(row: QuestionOptionRow): QuestionOption {
  return { id: row.id, questionId: row.questionId, label: row.label, text: row.text, position: row.position };
}

/** Joins each question row to its ordered options (openapi.yaml `Question.options`). */
export function loadQuestionsWithOptions(db: DrizzleDb, rows: readonly QuestionRow[]): Question[] {
  if (rows.length === 0) return [];
  const questionIds = rows.map((row) => row.id);
  const optionRows = db.select().from(questionOptions).where(inArray(questionOptions.questionId, questionIds)).all();
  const optionsByQuestionId = new Map<string, QuestionOptionRow[]>();
  for (const option of optionRows) {
    const list = optionsByQuestionId.get(option.questionId) ?? [];
    list.push(option);
    optionsByQuestionId.set(option.questionId, list);
  }
  return rows.map((row) => toQuestionDto(row, (optionsByQuestionId.get(row.id) ?? []).sort((a, b) => a.position - b.position)));
}

export function toQuestionDto(row: QuestionRow, optionRows: readonly QuestionOptionRow[]): Question {
  return {
    id: row.id,
    sessionId: row.sessionId,
    questionSetId: row.questionSetId,
    kind: row.kind,
    prompt: row.prompt,
    options: optionRows.map(toQuestionOptionDto),
    correctOptionId: row.correctOptionId,
    provenance: row.provenance,
    edited: row.edited,
    state: row.state,
    createdAt: row.createdAt,
    orderHint: row.orderHint,
  };
}

/** `listQuestionSets` — newest first (openapi.yaml summary). */
export function listQuestionSets(db: DrizzleDb, sessionId: string): QuestionSet[] {
  return db
    .select()
    .from(questionSets)
    .where(eq(questionSets.sessionId, sessionId))
    .orderBy(desc(questionSets.requestedAt))
    .all()
    .map(toQuestionSetDto);
}

/** `getQuestionSet` — the set plus its questions (openapi.yaml `QuestionSetDetail`); `null` when unknown (404). */
export function getQuestionSetDetail(db: DrizzleDb, setId: string): QuestionSetDetail | null {
  const row = db.select().from(questionSets).where(eq(questionSets.id, setId)).get();
  if (!row) return null;
  const questionRows = db.select().from(questions).where(eq(questions.questionSetId, setId)).all();
  return { ...toQuestionSetDto(row), questions: loadQuestionsWithOptions(db, questionRows) };
}

/** `listQuestions` — the question pool for a session, optionally filtered by state (openapi.yaml summary). */
export function listQuestions(db: DrizzleDb, sessionId: string, state?: QuestionState): Question[] {
  const where = state !== undefined ? and(eq(questions.sessionId, sessionId), eq(questions.state, state)) : eq(questions.sessionId, sessionId);
  const rows = db.select().from(questions).where(where).all();
  return loadQuestionsWithOptions(db, rows);
}
