import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import type { SourceExecutor } from './status.js';

/** Registers the sources operationId this task owns (openapi.yaml tag `sources`): `getSourcesStatus`. */
export function registerSourceRoutes(app: FastifyInstance, authService: AuthService, executor: SourceExecutor): void {
  app.get(
    '/api/v1/sources/status',
    { config: { operationId: 'getSourcesStatus' }, preHandler: requireAuth(authService, 'getSourcesStatus') },
    async (_request, reply) => {
      reply.code(200).send({ items: executor.getStatus() });
    },
  );
}
