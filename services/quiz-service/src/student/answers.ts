import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { SubmitAnswerResponse } from '@eduscope/shared';
import { zSubmitAnswerRequest } from '@eduscope/shared';
import { answers, publications, quizSessions, type StoredQuizOption } from '../db/schema.js';
import type { DeviceStreamHub } from '../device/stream.js';
import { resolveParticipantCookie } from './cookies.js';
import { QuizAppProblemError } from './identity.js';

interface UniqueViolation {
  code: string;
  constraint_name?: string;
}

function asUniqueViolation(value: unknown): UniqueViolation | undefined {
  if (typeof value !== 'object' || value === null || !('code' in value)) return undefined;
  return (value as { code: unknown }).code === '23505' ? (value as UniqueViolation) : undefined;
}

/** drizzle-orm's postgres-js driver wraps the raw `PostgresError` in a `DrizzleQueryError`, exposed via `.cause`. */
function unwrapUniqueViolation(error: unknown): UniqueViolation | undefined {
  return asUniqueViolation(error) ?? asUniqueViolation(error instanceof Error ? error.cause : undefined);
}

/**
 * `quiz-app.yaml`'s closed answer Problem catalog declares no publication
 * lookup, so an unauthenticated cookie, a publication outside the cookie
 * participant's own session, a missing publication, and a closed
 * session/publication all collapse onto this one code.
 */
function questionClosed(): QuizAppProblemError {
  return new QuizAppProblemError(409, 'question.closed', 'Question is not open for answers');
}

interface AnswerOutcome {
  outcome: 'accepted' | 'already-accepted';
  selectedOptionId: string;
  answerId: string;
  seq: number;
}

/** Registers D-owned `submitAnswer` (quiz-app.yaml tag: student-quiz). */
export function registerStudentAnswerRoutes(app: FastifyInstance, deviceStreamHub: DeviceStreamHub): void {
  app.post(
    '/api/student/v1/publications/:publicationId/answers',
    { config: { operationId: 'submitAnswer' } },
    async (request, reply) => {
      const principal = await resolveParticipantCookie(request, app.db, app.clock);
      if (!principal) {
        throw questionClosed();
      }

      const { publicationId } = request.params as { publicationId: string };
      const bodyResult = zSubmitAnswerRequest.safeParse(request.body);
      if (!bodyResult.success) {
        throw new QuizAppProblemError(422, 'answer.invalid-option', 'selectedOptionId must be a valid option id');
      }
      const { selectedOptionId } = bodyResult.data;
      const quizSessionId = principal.quizSessionId;

      const outcome = await app.sessionSerial.run(quizSessionId, () => {
        const receiveAt = app.clock.now();
        return app.db.transaction(async (tx): Promise<AnswerOutcome> => {
          const [publication] = await tx
            .select()
            .from(publications)
            .where(and(eq(publications.id, publicationId), eq(publications.quizSessionId, quizSessionId)))
            .for('update');
          if (!publication || publication.state !== 'open') {
            throw questionClosed();
          }

          const options = publication.options as StoredQuizOption[];
          if (!options.some((option) => option.id === selectedOptionId)) {
            throw new QuizAppProblemError(
              422,
              'answer.invalid-option',
              'selectedOptionId must be one of the published options',
            );
          }

          const [existing] = await tx
            .select()
            .from(answers)
            .where(and(eq(answers.publicationId, publicationId), eq(answers.studentId, principal.studentId)));
          if (existing) {
            return {
              outcome: 'already-accepted',
              selectedOptionId: existing.selectedOptionId,
              answerId: existing.id,
              seq: existing.seq,
            };
          }

          const [seqRow] = await tx
            .update(quizSessions)
            .set({ nextAnswerSeq: sql`${quizSessions.nextAnswerSeq} + 1` })
            .where(eq(quizSessions.id, quizSessionId))
            .returning({ seq: quizSessions.nextAnswerSeq });
          const seq = seqRow!.seq;

          const isCorrect = selectedOptionId === publication.correctOptionId;
          const pointsAwarded = isCorrect ? 10 : 0;
          const responseTimeMs = Math.max(0, receiveAt.getTime() - publication.publishedAt.getTime());
          const answerId = app.ids.next(receiveAt);

          try {
            await tx.insert(answers).values({
              id: answerId,
              quizSessionId,
              publicationId,
              studentId: principal.studentId,
              selectedOptionId,
              isCorrect,
              pointsAwarded,
              responseTimeMs,
              submittedAt: receiveAt,
              seq,
            });
          } catch (error) {
            if (!unwrapUniqueViolation(error)) throw error;
            const [reselected] = await tx
              .select()
              .from(answers)
              .where(and(eq(answers.publicationId, publicationId), eq(answers.studentId, principal.studentId)));
            if (!reselected) throw error;
            return {
              outcome: 'already-accepted',
              selectedOptionId: reselected.selectedOptionId,
              answerId: reselected.id,
              seq: reselected.seq,
            };
          }

          return { outcome: 'accepted', selectedOptionId, answerId, seq };
        });
      });

      if (outcome.outcome === 'accepted') {
        app.domainEvents.emit('answer.accepted', { quizSessionId, answerId: outcome.answerId, seq: outcome.seq });
        deviceStreamHub.enqueueAnswer(quizSessionId);
      }

      const response: SubmitAnswerResponse = { outcome: outcome.outcome, selectedOptionId: outcome.selectedOptionId };
      reply.code(200).send(response);
    },
  );
}
