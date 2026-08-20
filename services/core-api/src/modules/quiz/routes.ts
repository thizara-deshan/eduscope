import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import { ProblemError } from '../../contracts/problem.js';
import { parseBody } from '../../contracts/validate.js';
import { eq } from 'drizzle-orm';
import type { DrizzleDb } from '../../db/client.js';
import { questionPublications } from '../../db/schema.js';
import type { Clock } from '../../lib/clock.js';
import { listPublicationResponses } from './responses.js';
import { getLeaderboard } from './leaderboard.js';
import type { QuizSessionMachine } from './session.js';

const zSessionIdQuery = z.object({ sessionId: z.string().min(1) });

export interface QuizRoutesDeps {
  db: DrizzleDb;
  clock: Clock;
}

/** Registers this task's operationIds (openapi.yaml tag `quiz`): `getQuizSession`, `listPublicationResponses`, `getLeaderboard`. */
export function registerQuizRoutes(app: FastifyInstance, authService: AuthService, sessionMachine: QuizSessionMachine, deps: QuizRoutesDeps): void {
  app.get(
    '/api/v1/quiz/session',
    { config: { operationId: 'getQuizSession' }, preHandler: requireAuth(authService, 'getQuizSession') },
    async (_request, reply) => {
      reply.code(200).send(sessionMachine.snapshot());
    },
  );

  app.get(
    '/api/v1/quiz/publications/:publicationId/responses',
    { config: { operationId: 'listPublicationResponses' }, preHandler: requireAuth(authService, 'listPublicationResponses') },
    async (request, reply) => {
      const { publicationId } = request.params as { publicationId: string };
      const publication = deps.db.select({ id: questionPublications.id }).from(questionPublications).where(eq(questionPublications.id, publicationId)).get();
      if (!publication) throw new ProblemError(404, 'not-found', 'Publication not found');
      reply.code(200).send(listPublicationResponses(deps.db, publicationId));
    },
  );

  app.get(
    '/api/v1/quiz/leaderboard',
    { config: { operationId: 'getLeaderboard' }, preHandler: requireAuth(authService, 'getLeaderboard') },
    async (request, reply) => {
      const { sessionId } = parseBody(zSessionIdQuery, request.query);
      reply.code(200).send(getLeaderboard(deps.db, deps.clock, sessionId));
    },
  );
}
