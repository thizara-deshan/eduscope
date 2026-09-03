import type { FastifyInstance } from 'fastify';
import type { AuthService } from '../auth/service.js';
import { requireAuth } from '../auth/guard.js';
import type { PipelineManagerClient } from '../recording/pm/client.js';

const ROLES = new Set(['presentation', 'lecturer-cam', 'students-cam']);

export function registerJpegPreviewRoute(app: FastifyInstance, auth: AuthService, pm: PipelineManagerClient): void {
  app.get<{ Params: { roleId: string } }>(
    '/api/v1/sources/:roleId/preview.jpg',
    { config: { operationId: 'getSourcesStatus' }, preHandler: requireAuth(auth, 'getSourcesStatus') },
    async (request, reply) => {
      if (!ROLES.has(request.params.roleId)) {
        return reply.code(404).send({ code: 'not_found', title: 'Preview role not found', status: 404 });
      }
      const bytes = await pm.getJpegThumbnail(request.params.roleId);
      return reply.header('content-type', 'image/jpeg').header('cache-control', 'no-store').send(Buffer.from(bytes));
    },
  );
}
