import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { RegisterParticipantResponse } from '@eduscope/shared';
import { participants, participantSessions, quizSessions, students } from '../db/schema.js';
import { generateParticipantToken, hashParticipantToken, issueParticipantCookie } from './cookies.js';
import { QuizAppProblemError, SelfRegistrationIdentityProvider, type IdentityProvider } from './identity.js';

const MAX_PARTICIPANTS_PER_SESSION = 1000;

const identityProvider: IdentityProvider = new SelfRegistrationIdentityProvider();

const REGISTER_RATE_LIMIT = {
  max: 5,
  timeWindow: 60_000,
  errorResponseBuilder: () =>
    new QuizAppProblemError(503, 'quiz.unavailable', 'Too many registration attempts, try again shortly'),
};

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

/** Registers D-owned `registerParticipant` (quiz-app.yaml tag: student-quiz). */
export function registerStudentRegistrationRoutes(app: FastifyInstance): void {
  app.post(
    '/api/student/v1/quiz-sessions/:quizSessionId/participants',
    { config: { operationId: 'registerParticipant', rateLimit: REGISTER_RATE_LIMIT } },
    async (request, reply) => {
      const { quizSessionId } = request.params as { quizSessionId: string };
      const identity = await identityProvider.resolve(request.body);
      if ('redirect' in identity) {
        throw new QuizAppProblemError(503, 'quiz.unavailable', 'Registration is not available for this provider');
      }

      const outcome = await app.sessionSerial.run(quizSessionId, () =>
        app.db.transaction(async (tx) => {
          const [session] = await tx
            .select()
            .from(quizSessions)
            .where(eq(quizSessions.id, quizSessionId))
            .for('update');
          // The closed quiz-app.yaml Problem catalog declares no registration
          // 404, so a missing/unknown session shares `quiz.unavailable` with
          // the rate-limit/cap exhaustion path; only a known, non-open row
          // is `quiz.session-closed`.
          if (!session) {
            throw new QuizAppProblemError(503, 'quiz.unavailable', 'Quiz session is not available');
          }
          if (session.state !== 'open') {
            throw new QuizAppProblemError(409, 'quiz.session-closed', 'Quiz session is closed');
          }

          const now = app.clock.now();

          let studentId: string;
          const [existingStudent] = await tx
            .select()
            .from(students)
            .where(eq(students.studentIdNumber, identity.studentIdNumber))
            .for('update');

          if (existingStudent) {
            studentId = existingStudent.id;
            await tx
              .update(students)
              .set({ fullName: identity.fullName, lastSeenAt: now })
              .where(eq(students.id, studentId));
          } else {
            studentId = app.ids.next(now);
            try {
              await tx.insert(students).values({
                id: studentId,
                studentIdNumber: identity.studentIdNumber,
                fullName: identity.fullName,
                authMethod: 'self-registered',
                createdAt: now,
                lastSeenAt: now,
              });
            } catch (error) {
              if (!unwrapUniqueViolation(error)) throw error;
              const [reselected] = await tx
                .select()
                .from(students)
                .where(eq(students.studentIdNumber, identity.studentIdNumber));
              if (!reselected) throw error;
              studentId = reselected.id;
              await tx
                .update(students)
                .set({ fullName: identity.fullName, lastSeenAt: now })
                .where(eq(students.id, studentId));
            }
          }

          const [existingParticipant] = await tx
            .select()
            .from(participants)
            .where(and(eq(participants.quizSessionId, quizSessionId), eq(participants.studentId, studentId)))
            .for('update');

          let participantId: string;
          let participantOutcome: 'created' | 'rejoined';
          let isNewParticipant = false;

          if (existingParticipant) {
            participantId = existingParticipant.id;
            participantOutcome = 'rejoined';
          } else {
            const [countRow] = await tx
              .select({ count: sql<number>`count(*)::int` })
              .from(participants)
              .where(eq(participants.quizSessionId, quizSessionId));
            if (countRow!.count >= MAX_PARTICIPANTS_PER_SESSION) {
              throw new QuizAppProblemError(503, 'quiz.unavailable', 'Quiz session has reached its participant cap');
            }

            participantId = app.ids.next(now);
            try {
              await tx.insert(participants).values({
                id: participantId,
                quizSessionId,
                studentId,
                joinedAt: now,
                lastSeenAt: now,
                connectionState: 'offline',
              });
              participantOutcome = 'created';
              isNewParticipant = true;
            } catch (error) {
              if (!unwrapUniqueViolation(error)) throw error;
              const [reselected] = await tx
                .select()
                .from(participants)
                .where(and(eq(participants.quizSessionId, quizSessionId), eq(participants.studentId, studentId)));
              if (!reselected) throw error;
              participantId = reselected.id;
              participantOutcome = 'rejoined';
            }
          }

          const token = generateParticipantToken();
          const expiresAt = new Date(now.getTime() + app.config.participantSessionTtlSec * 1000);
          await tx.insert(participantSessions).values({
            tokenHash: hashParticipantToken(token),
            participantId,
            studentId,
            issuedAt: now,
            expiresAt,
          });

          return { participantId, outcome: participantOutcome, token, isNewParticipant };
        }),
      );

      issueParticipantCookie(reply, app.config, outcome.token);
      if (outcome.isNewParticipant) {
        app.domainEvents.emit('participant.joined', { quizSessionId, participantId: outcome.participantId });
      }

      const response: RegisterParticipantResponse = {
        quizSessionId,
        participantId: outcome.participantId,
        outcome: outcome.outcome,
      };
      reply.code(200).send(response);
    },
  );
}
