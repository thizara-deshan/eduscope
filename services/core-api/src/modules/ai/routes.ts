import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import { parseBody } from '../../contracts/validate.js';
import type { AiCountdown } from './countdown.js';

/**
 * `IntervalMinutes` (openapi.yaml `type: integer, enum: [10,15,20,30]`)
 * generates as `z.unknown()` in the openapi→zod pipeline (packages/shared's
 * generated `zIntervalMinutes`) — the generated schema stays untouched per
 * plan constraints, so this route validates the literal union itself (A-14).
 */
const zSetIntervalRequestStrict = z.object({
  intervalMinutes: z.union([z.literal(10), z.literal(15), z.literal(20), z.literal(30)]),
});

/** Registers this task's operationIds (openapi.yaml tag `ai`): `getAiCountdown`, `setAiInterval`, `generateNow`. */
export function registerAiRoutes(app: FastifyInstance, authService: AuthService, countdown: AiCountdown): void {
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
}
