import { and, eq } from 'drizzle-orm';
import type { AnswerProjection, QuizResponsesPayload } from '@eduscope/shared';
import type { DrizzleDb } from '../../db/client.js';
import { answerProjections, questionPublications, quizSessionProjections } from '../../db/schema.js';
import type { Clock } from '../../lib/clock.js';
import type { DomainBus } from '../../lib/domain-bus.js';

/** `sync.answers` batch item (events.md §4) — the wire shape B-34's WS stream parses and hands to `ingestAnswers`; B-33's own tests call this directly with a fake batch. */
export interface AnswerBatchItem {
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

export interface IngestAnswersDeps {
  db: DrizzleDb;
  clock: Clock;
  bus: DomainBus;
}

/**
 * Ingests one `sync.answers` batch (Z-22's downstream effect): upserts each
 * answer keyed by `(publicationId, studentIdNumber)` — INV-AP-1 replaces,
 * never edits, so a resend or a corrected answer both converge to the same
 * row — advances the quiz session's durable `lastAnswerSeq` watermark
 * (`sync.hello`'s `answerWatermark`, B-34), and emits one coalesced
 * `quiz.responses` per affected publication.
 */
export function ingestAnswers(deps: IngestAnswersDeps, quizSessionId: string, answers: readonly AnswerBatchItem[]): void {
  if (answers.length === 0) return;
  const { db, clock, bus } = deps;
  const nowIso = clock.now().toISOString();
  const maxSeq = Math.max(...answers.map((answer) => answer.seq));
  const deltasByPublication = new Map<string, QuizResponsesPayload['deltas']>();

  db.transaction((tx) => {
    for (const answer of answers) {
      tx.insert(answerProjections)
        .values({
          id: answer.answerId,
          publicationId: answer.publicationId,
          studentIdNumber: answer.studentIdNumber,
          studentDisplayName: answer.studentDisplayName,
          selectedOptionId: answer.selectedOptionId,
          isCorrect: answer.isCorrect,
          responseTimeMs: answer.responseTimeMs,
          submittedAt: answer.submittedAt,
          syncedAt: nowIso,
        })
        .onConflictDoUpdate({
          target: [answerProjections.publicationId, answerProjections.studentIdNumber],
          set: {
            id: answer.answerId,
            studentDisplayName: answer.studentDisplayName,
            selectedOptionId: answer.selectedOptionId,
            isCorrect: answer.isCorrect,
            responseTimeMs: answer.responseTimeMs,
            submittedAt: answer.submittedAt,
            syncedAt: nowIso,
          },
        })
        .run();

      const deltas = deltasByPublication.get(answer.publicationId) ?? [];
      deltas.push({
        studentIdNumber: answer.studentIdNumber,
        displayName: answer.studentDisplayName,
        selectedOptionId: answer.selectedOptionId,
        isCorrect: answer.isCorrect,
        responseTimeMs: answer.responseTimeMs,
        submittedAt: answer.submittedAt,
      });
      deltasByPublication.set(answer.publicationId, deltas);
    }

    const current = tx.select({ lastAnswerSeq: quizSessionProjections.lastAnswerSeq }).from(quizSessionProjections).where(eq(quizSessionProjections.id, quizSessionId)).get();
    if (current && maxSeq > current.lastAnswerSeq) {
      tx.update(quizSessionProjections).set({ lastAnswerSeq: maxSeq }).where(eq(quizSessionProjections.id, quizSessionId)).run();
    }

    for (const publicationId of deltasByPublication.keys()) {
      tx.update(questionPublications).set({ syncState: 'synced' }).where(eq(questionPublications.id, publicationId)).run();
    }
  });

  for (const [publicationId, deltas] of deltasByPublication) {
    bus.publish('quiz.responses', { publicationId, deltas, syncedAt: nowIso, stale: false });
  }
}

function toAnswerProjectionDto(row: typeof answerProjections.$inferSelect): AnswerProjection {
  return {
    id: row.id,
    publicationId: row.publicationId,
    studentIdNumber: row.studentIdNumber,
    studentDisplayName: row.studentDisplayName,
    selectedOptionId: row.selectedOptionId,
    isCorrect: row.isCorrect,
    responseTimeMs: row.responseTimeMs,
    submittedAt: row.submittedAt,
    syncedAt: row.syncedAt,
  };
}

/** `listPublicationResponses` (LP-17 drill-down, DM-14) — read-only, minimal-PII `AnswerProjection` rows for one publication. */
export function listPublicationResponses(db: DrizzleDb, publicationId: string): { items: AnswerProjection[]; syncedAt: string; stale: boolean } {
  const rows = db.select().from(answerProjections).where(eq(answerProjections.publicationId, publicationId)).all();
  const publication = db.select({ syncState: questionPublications.syncState }).from(questionPublications).where(eq(questionPublications.id, publicationId)).get();
  const syncedAt = rows.reduce<string>((latest, row) => (row.syncedAt > latest ? row.syncedAt : latest), '');
  return { items: rows.map(toAnswerProjectionDto), syncedAt: syncedAt || new Date(0).toISOString(), stale: publication?.syncState === 'stale' || publication?.syncState === 'failed' };
}

/** Answers scoped to the current publication's quiz session — used to reject cross-session leakage before ingesting (defense in depth for B-34's dispatcher). */
export function publicationBelongsToQuizSession(db: DrizzleDb, publicationId: string, quizSessionId: string): boolean {
  const row = db.select({ quizSessionId: questionPublications.quizSessionId }).from(questionPublications).where(and(eq(questionPublications.id, publicationId), eq(questionPublications.quizSessionId, quizSessionId))).get();
  return row !== undefined;
}
