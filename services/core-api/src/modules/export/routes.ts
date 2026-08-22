import { zExportCreateRequest } from '@eduscope/shared';
import type { FastifyInstance } from 'fastify';
import { parseBody } from '../../contracts/validate.js';
import { requireAuth } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import type { ScopedSubscriptionRegistry } from './subscriptions.js';
import type { ExportExecutor } from './worker.js';

export function registerExportRoutes(app: FastifyInstance, authService: AuthService, executor: ExportExecutor, subscriptions: ScopedSubscriptionRegistry): void {
  app.get('/api/v1/exports/targets', { config: { operationId: 'listExportTargets' }, preHandler: requireAuth(authService, 'listExportTargets') }, async (request, reply) => {
    subscriptions.refresh(request.authContext!.authSessionId, 'usb.volumes');
    reply.code(200).send({ items: await executor.listTargets() });
  });
  app.post('/api/v1/exports', { config: { operationId: 'createExport' }, preHandler: requireAuth(authService, 'createExport') }, async (request, reply) => {
    const input = parseBody(zExportCreateRequest, request.body);
    reply.code(202).send(await executor.create(input, request.authContext!));
  });
  app.get('/api/v1/exports/:exportId', { config: { operationId: 'getExport' }, preHandler: requireAuth(authService, 'getExport') }, async (request, reply) => {
    const { exportId } = request.params as { exportId: string };
    reply.code(200).send(executor.get(exportId, request.authContext!));
  });
  app.post('/api/v1/exports/:exportId/cancel', { config: { operationId: 'cancelExport' }, preHandler: requireAuth(authService, 'cancelExport') }, async (request, reply) => {
    const { exportId } = request.params as { exportId: string };
    reply.code(202).send(await executor.cancel(exportId, request.authContext!));
  });
}
