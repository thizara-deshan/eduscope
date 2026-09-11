import type { FastifyInstance } from 'fastify';
import type { AuthService } from '../auth/service.js';
import { requireAuth } from '../auth/guard.js';
import type { PipelineManagerClient } from '../recording/pm/client.js';
import { PipelineManagerError } from '../recording/pm/types.js';
import { ProblemError } from '../../contracts/problem.js';

const ROLES = new Set(['presentation', 'lecturer-cam', 'students-cam']);

export function registerJpegPreviewRoute(app: FastifyInstance, auth: AuthService, pm: PipelineManagerClient): void {
  let previewStart: Promise<void> | null = null;
  const ensurePreviewStarted = async (): Promise<void> => {
    previewStart ??= pm.startThumbnails([...ROLES]).finally(() => { previewStart = null; });
    await previewStart;
  };

  app.get<{ Params: { roleId: string } }>(
    '/api/v1/sources/:roleId/preview.jpg',
    { config: { operationId: 'getSourcePreview' }, preHandler: requireAuth(auth, 'getSourcePreview') },
    async (request, reply) => {
      if (!ROLES.has(request.params.roleId)) {
        throw new ProblemError(404, 'not-found', 'Preview role not found');
      }
      let bytes: Uint8Array;
      try {
        bytes = await pm.getJpegThumbnail(request.params.roleId);
      } catch (error) {
        if (!(error instanceof PipelineManagerError)
          || !['consumer_not_found', 'thumbnail_unavailable'].includes(error.problem.code)) throw error;
        await ensurePreviewStarted();
        bytes = await pm.getJpegThumbnail(request.params.roleId);
      }
      return reply.header('content-type', 'image/jpeg').header('cache-control', 'no-store').send(Buffer.from(bytes));
    },
  );
}
