import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import type { ChannelExecutor } from './machine.js';

/** Registers the channel runtime operationIds this task owns (openapi.yaml tag `channels`): `enableChannel`, `disableChannel`. */
export function registerChannelRuntimeRoutes(app: FastifyInstance, authService: AuthService, executor: ChannelExecutor): void {
  app.post(
    '/api/v1/channels/:channelId/enable',
    { config: { operationId: 'enableChannel' }, preHandler: requireAuth(authService, 'enableChannel') },
    async (request, reply) => {
      const { channelId } = request.params as { channelId: string };
      const result = await executor.enable(channelId, request.authContext!);
      reply.code(202).send(result);
    },
  );

  app.post(
    '/api/v1/channels/:channelId/disable',
    { config: { operationId: 'disableChannel' }, preHandler: requireAuth(authService, 'disableChannel') },
    async (request, reply) => {
      const { channelId } = request.params as { channelId: string };
      const result = await executor.disable(channelId, request.authContext!);
      reply.code(202).send(result);
    },
  );
}
