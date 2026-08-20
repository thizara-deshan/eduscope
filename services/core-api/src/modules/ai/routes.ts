import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import { ProblemError } from '../../contracts/problem.js';
import { parseBody } from '../../contracts/validate.js';
import type { DrizzleDb } from '../../db/client.js';
import type { AiCountdown } from './countdown.js';
import { getQuestionSetDetail, listQuestionSets } from './question-sets.js';

/**
 * `IntervalMinutes` (openapi.yaml `type: integer, enum: [10,15,20,30]`)
 * generates as `z.unknown()` in the openapi→zod pipeline (packages/shared's
 * generated `zIntervalMinutes`) — the generated schema stays untouched per
 * plan constraints, so this route validates the literal union itself (A-14).
 */
const zSetIntervalRequestStrict = z.object({
  intervalMinutes: z.union([z.literal(10), z.literal(15), z.literal(20), z.literal(30)]),
});

const zSessionIdQuery = z.object({ sessionId: z.string().min(1) });

export interface AiRoutesDeps {
  db: DrizzleDb;
}

/** Registers this task's operationIds (openapi.yaml tag `ai`): `getAiCountdown`, `setAiInterval`, `generateNow`, `listQuestionSets`, `getQuestionSet`. */
export function registerAiRoutes(app: FastifyInstance, authService: AuthService, countdown: AiCountdown, deps: AiRoutesDeps): void {
  app.get(
    '/api/v1/ai/countdown',
    { config: { operationId: 'getAiCountdown' }, preHandler: requireAuth(authService, 'getAiCountdown') },
    async (_request, reply) => {
      reply.code(200).send(countdown.snapshot());
    },
  );

  app.put(
    '/api/v1/ai/interval',
    { config: { operationId: 'setAiInterval' }, preHandler: requireAuth(authService, 'setAiInterval') },
    async (request, reply) => {
      const body = parseBody(zSetIntervalRequestStrict, request.body);
      const accepted = countdown.setInterval(body.intervalMinutes, request.authContext!);
      reply.code(202).send(accepted);
    },
  );

  app.post(
    '/api/v1/ai/generate-now',
    { config: { operationId: 'generateNow' }, preHandler: requireAuth(authService, 'generateNow') },
    async (request, reply) => {
      const accepted = countdown.generateNow(request.authContext!);
      reply.code(202).send(accepted);
    },
  );

  app.get(
    '/api/v1/ai/question-sets',
    { config: { operationId: 'listQuestionSets' }, preHandler: requireAuth(authService, 'listQuestionSets') },
    async (request, reply) => {
      const { sessionId } = parseBody(zSessionIdQuery, request.query);
      reply.code(200).send({ items: listQuestionSets(deps.db, sessionId) });
    },
  );

  app.get(
    '/api/v1/ai/question-sets/:setId',
    { config: { operationId: 'getQuestionSet' }, preHandler: requireAuth(authService, 'getQuestionSet') },
    async (request, reply) => {
      const { setId } = request.params as { setId: string };
      const detail = getQuestionSetDetail(deps.db, setId);
      if (!detail) throw new ProblemError(404, 'not-found', 'Question set not found');
      reply.code(200).send(detail);
    },
  );
}
