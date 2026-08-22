import { zUploadJobState } from '@eduscope/shared';
import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import type { UploadScheduler } from './scheduler.js';

export function registerUploadRoutes(app: FastifyInstance, authService: AuthService, scheduler: UploadScheduler): void {
  app.get('/api/v1/uploads', { config: { operationId: 'listUploadJobs' }, preHandler: requireAuth(authService, 'listUploadJobs') }, async (request, reply) => {
    const query = request.query as { state?: string };
    const state = query.state === undefined ? undefined : zUploadJobState.parse(query.state);
    reply.code(200).send(scheduler.machine.list(request.authContext!, state));
  });
  app.get('/api/v1/uploads/:jobId', { config: { operationId: 'getUploadJob' }, preHandler: requireAuth(authService, 'getUploadJob') }, async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    reply.code(200).send(scheduler.machine.get(request.authContext!, jobId));
  });
  app.post('/api/v1/uploads/:jobId/requeue', { config: { operationId: 'requeueUploadJob' }, preHandler: requireAuth(authService, 'requeueUploadJob') }, async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const result = scheduler.machine.requeue(request.authContext!, jobId);
    scheduler.wake();
    reply.code(202).send(result);
  });
}
