import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import type { RecordingExecutor } from './executor.js';

/** Registers the recording operationIds this task owns (openapi.yaml tag `recording`): `getRecordingState`, `startRecording`. */
export function registerRecordingRoutes(app: FastifyInstance, authService: AuthService, executor: RecordingExecutor): void {
  app.get(
    '/api/v1/recording/state',
    { config: { operationId: 'getRecordingState' }, preHandler: requireAuth(authService, 'getRecordingState') },
    async (_request, reply) => {
      reply.code(200).send(executor.getState());
    },
  );

  app.post(
    '/api/v1/recording/start',
    { config: { operationId: 'startRecording' }, preHandler: requireAuth(authService, 'startRecording') },
    async (request, reply) => {
      const result = await executor.startRecording(request.authContext!);
      reply.code(202).send(result);
    },
  );
}
