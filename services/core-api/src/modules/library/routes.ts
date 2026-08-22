import type { FastifyInstance } from 'fastify';
import { zUlid } from '@eduscope/shared';
import { z } from 'zod';
import { parseBody } from '../../contracts/validate.js';
import { requireAuth } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import { deleteRecording, retryMergeRecording, type LibraryDeleteDeps } from './delete.js';
import { getRecording, listRecordings, type ListRecordingsQuery } from './queries.js';

const zListRecordingsQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  state: z.enum(['capturing', 'finalizing', 'merging', 'ready', 'failed', 'deleted']).optional(),
  includeDeleted: z.union([z.boolean(), z.literal('true'), z.literal('false')]).optional(),
  q: z.string().max(256).optional(),
  ownerUserId: zUlid.optional(),
});

const DEFAULT_LIST_RECORDINGS_LIMIT = 50;

export type LibraryRoutesDeps = LibraryDeleteDeps;

/** Registers the library operationIds this task owns (openapi.yaml tag `recordings`): `listRecordings`, `getRecording`, `deleteRecording`, `retryMergeRecording`. */
export function registerLibraryRoutes(app: FastifyInstance, authService: AuthService, deps: LibraryRoutesDeps): void {
  app.get(
    '/api/v1/recordings',
    { config: { operationId: 'listRecordings' }, preHandler: requireAuth(authService, 'listRecordings') },
    async (request, reply) => {
      const parsed = parseBody(zListRecordingsQuery, request.query);
      const query: ListRecordingsQuery = {
        cursor: parsed.cursor,
        limit: parsed.limit ?? DEFAULT_LIST_RECORDINGS_LIMIT,
        state: parsed.state,
        includeDeleted: parsed.includeDeleted === true || parsed.includeDeleted === 'true',
        q: parsed.q,
        ownerUserId: parsed.ownerUserId,
      };
      const result = listRecordings(deps.db, request.authContext!, query);
      reply.code(200).send(result);
    },
  );

  app.get(
    '/api/v1/recordings/:recordingId',
    { config: { operationId: 'getRecording' }, preHandler: requireAuth(authService, 'getRecording') },
    async (request, reply) => {
      const { recordingId } = request.params as { recordingId: string };
      const result = getRecording(deps.db, recordingId, request.authContext!);
      reply.code(200).send(result);
    },
  );

  app.delete(
    '/api/v1/recordings/:recordingId',
    { config: { operationId: 'deleteRecording' }, preHandler: requireAuth(authService, 'deleteRecording') },
    async (request, reply) => {
      const { recordingId } = request.params as { recordingId: string };
      const result = deleteRecording(deps, recordingId, request.authContext!);
      reply.code(202).send(result);
    },
  );

  app.post(
    '/api/v1/recordings/:recordingId/retry-merge',
    { config: { operationId: 'retryMergeRecording' }, preHandler: requireAuth(authService, 'retryMergeRecording') },
    async (request, reply) => {
      const { recordingId } = request.params as { recordingId: string };
      const result = retryMergeRecording(deps, recordingId, request.authContext!);
      reply.code(202).send(result);
    },
  );
}
