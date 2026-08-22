import type { FastifyInstance } from 'fastify';
import { zProjectorRequest } from '@eduscope/shared';
import { z } from 'zod';
import { requireAuth } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import { parseBody } from '../../contracts/validate.js';
import type { PublicationOrchestrator } from './projector.js';

const zSessionIdQuery = z.object({ sessionId: z.string().min(1) });

/** Registers this task's operationIds (openapi.yaml tag `ai`): `sendToProjector`, `listPublications`, `closePublication`, `setProjector`. */
export function registerPublicationRoutes(app: FastifyInstance, authService: AuthService, orchestrator: PublicationOrchestrator): void {
  app.post(
    '/api/v1/ai/questions/:questionId/send-to-projector',
    { config: { operationId: 'sendToProjector' }, preHandler: requireAuth(authService, 'sendToProjector') },
    async (request, reply) => {
      const { questionId } = request.params as { questionId: string };
      const result = orchestrator.sendToProjector(request.authContext!, questionId);
      reply.code(202).send(result);
    },
  );

  app.get(
    '/api/v1/ai/publications',
    { config: { operationId: 'listPublications' }, preHandler: requireAuth(authService, 'listPublications') },
    async (request, reply) => {
      const { sessionId } = parseBody(zSessionIdQuery, request.query);
      reply.code(200).send({ items: orchestrator.listPublications(sessionId) });
    },
  );

  app.post(
    '/api/v1/ai/publications/:publicationId/close',
    { config: { operationId: 'closePublication' }, preHandler: requireAuth(authService, 'closePublication') },
    async (request, reply) => {
      const { publicationId } = request.params as { publicationId: string };
      const result = orchestrator.closePublication(request.authContext!, publicationId);
      reply.code(202).send(result);
    },
  );

  app.put(
    '/api/v1/ai/projector',
    { config: { operationId: 'setProjector' }, preHandler: requireAuth(authService, 'setProjector') },
    async (request, reply) => {
      const body = parseBody(zProjectorRequest, request.body);
      const result = orchestrator.setProjector(request.authContext!, body.publicationId);
      reply.code(202).send(result);
    },
  );
}
