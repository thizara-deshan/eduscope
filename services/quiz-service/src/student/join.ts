import { desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { RegistrationPolicy, ResolveJoinCodeResponse } from '@eduscope/shared';
import { quizSessions } from '../db/schema.js';
import { resolveParticipantCookie } from './cookies.js';
import { QuizAppProblemError } from './identity.js';

const REGISTRATION_POLICY: RegistrationPolicy = {
  studentIdPattern: '^[A-Z]{2}[0-9]{7,8}$',
  studentIdHint: 'Two uppercase letters followed by 7 or 8 digits',
  inputMode: 'text',
  studentIdMaxLength: 10,
  fullNameMaxLength: 128,
};

const RESOLVE_RATE_LIMIT = {
  max: 10,
  timeWindow: 60_000,
  errorResponseBuilder: () =>
    new QuizAppProblemError(503, 'quiz.unavailable', 'Too many join-code lookups, try again shortly'),
};

/**
 * Registers D-owned `resolveJoinCode` (quiz-app.yaml tag: student-quiz).
 * Public, rate-limited, and read-only — it never creates a participant
 * (INV-QP-1). A join code is unique only among currently-open sessions, so a
 * closed session with a reused code can still be resolved for `state:
 * 'closed'`; the currently-open session for a code always wins.
 */
export function registerStudentJoinRoutes(app: FastifyInstance): void {
  app.get(
    '/api/student/v1/join-codes/:joinCode',
    { config: { operationId: 'resolveJoinCode', rateLimit: RESOLVE_RATE_LIMIT } },
    async (request) => {
      const { joinCode } = request.params as { joinCode: string };
      const code = joinCode.toUpperCase();

      const [session] = await app.db
        .select()
        .from(quizSessions)
        .where(eq(quizSessions.joinCode, code))
        .orderBy(sql`CASE WHEN ${quizSessions.state} = 'open' THEN 0 ELSE 1 END`, desc(quizSessions.openedAt))
        .limit(1);

      if (!session) {
        throw new QuizAppProblemError(404, 'quiz.session-not-found', 'No quiz session for this join code');
      }

      const principal = await resolveParticipantCookie(request, app.db, app.clock);
      const participantState =
        principal !== undefined && principal.quizSessionId === session.id ? 'returning' : 'anonymous';

      const response: ResolveJoinCodeResponse = {
        quizSessionId: session.id,
        state: session.state as 'open' | 'closed',
        participantState,
        registrationPolicy: REGISTRATION_POLICY,
      };
      return response;
    },
  );
}
