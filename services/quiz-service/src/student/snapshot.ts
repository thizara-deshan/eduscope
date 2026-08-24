import { and, desc, eq } from 'drizzle-orm';
import type { StudentServerEvent } from '@eduscope/shared';
import type { QuizDb } from '../db/client.js';
import { answers, publications, quizSessions } from '../db/schema.js';
import type { ParticipantPrincipal } from './cookies.js';
import { serializeParticipant, serializeQuestion, serializeResult, serializeSessionTerminal, toCurrentPublicationRow } from './serializers.js';

/**
 * events.md §5.1 — one repeatable-read transaction producing the exact
 * cold-connect order: session, participant, question, then an own result
 * only when a current own result applies. Never writes connection state
 * (`StudentStreamHub.attach` owns that transition after this resolves) so a
 * read-only snapshot can never race a concurrent mutation under the same
 * session-serial key into an inconsistent partial view.
 */
export async function buildSnapshot(db: QuizDb, principal: ParticipantPrincipal): Promise<StudentServerEvent[]> {
  return db.transaction(
    async (tx) => {
      const [session] = await tx.select().from(quizSessions).where(eq(quizSessions.id, principal.quizSessionId));
      const events: StudentServerEvent[] = [];

      events.push({
        event: 'quiz.session',
        payload:
          session?.state === 'closed'
            ? await serializeSessionTerminal(tx, principal.quizSessionId, principal.studentIdNumber)
            : { state: 'open' },
      });

      events.push({ event: 'quiz.participant', payload: serializeParticipant() });

      const [currentPublication] = await tx
        .select()
        .from(publications)
        .where(eq(publications.quizSessionId, principal.quizSessionId))
        .orderBy(desc(publications.publishedAt))
        .limit(1);

      if (!currentPublication) {
        events.push({ event: 'quiz.question', payload: { state: 'none' } });
        return events;
      }

      const [ownAnswer] = await tx
        .select()
        .from(answers)
        .where(and(eq(answers.publicationId, currentPublication.id), eq(answers.studentId, principal.studentId)));

      const row = toCurrentPublicationRow(currentPublication);
      events.push({ event: 'quiz.question', payload: serializeQuestion(row, ownAnswer?.selectedOptionId ?? null) });

      if (currentPublication.state === 'closed') {
        events.push({
          event: 'quiz.result',
          payload: await serializeResult(tx, principal.quizSessionId, principal.studentIdNumber, row, ownAnswer),
        });
      }

      return events;
    },
    { isolationLevel: 'repeatable read' },
  );
}
