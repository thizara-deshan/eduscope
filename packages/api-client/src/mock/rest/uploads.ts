import {
  zCommandAccepted, zPage, zUploadJob, zUploadJobDetail,
  type CommandAccepted, type Page, type Ulid, type UploadJob,
  type UploadJobDetail, type UploadJobState,
} from '@eduscope/shared';
import { ProblemError } from '../../errors.js';
import { RESOLVE_BY_SEC } from '../commands.js';
import { validated, nowIsoZ } from '../seed/index.js';
import { nextUlid } from '../world.js';
import { requireAdmin } from './auth.js';
import type { RestContext } from './index.js';

const DEFAULT_LIMIT = 20;

export function createUploadsOperations(ctx: RestContext) {
  const { world, engine, seed } = ctx;

  return {
    listUploadJobs: async (query?: {
      cursor?: string;
      limit?: number;
      state?: UploadJobState;
    }): Promise<Page<UploadJob>> => {
      requireAdmin(ctx);
      let rows = seed.uploadJobs;
      if (query?.state) rows = rows.filter((j) => j.state === query.state);

      const limit = query?.limit ?? DEFAULT_LIMIT;
      const start = query?.cursor ? Number.parseInt(query.cursor, 10) : 0;
      const page = rows.slice(start, start + limit);
      const nextCursor = start + limit < rows.length ? String(start + limit) : null;

      return validated(zPage(zUploadJob), { items: page, nextCursor });
    },

    getUploadJob: async (jobId: Ulid): Promise<UploadJobDetail> => {
      requireAdmin(ctx);
      const row = seed.uploadJobs.find((j) => j.id === jobId);
      if (!row) throw new ProblemError({ status: 404, code: 'not-found', title: `Unknown upload job: ${jobId}` });
      return validated(zUploadJobDetail, row);
    },

    requeueUploadJob: async (jobId: Ulid): Promise<CommandAccepted> => {
      requireAdmin(ctx);
      const refusal = engine.onCommand('requeueUploadJob');
      if (refusal) throw new ProblemError(refusal);
      const row = seed.uploadJobs.find((j) => j.id === jobId);
      if (!row) throw new ProblemError({ status: 404, code: 'not-found', title: `Unknown upload job: ${jobId}` });
      if (row.state !== 'dead-letter') {
        throw new ProblemError({
          status: 409,
          code: 'upload.not-requeueable',
          title: 'Only dead-letter jobs can be requeued',
        });
      }
      row.state = 'queued';
      row.attempt += 1;
      row.lastError = null;
      row.lastErrorAt = null;
      row.requeuedAt = nowIsoZ(world.clock);
      return validated(zCommandAccepted, {
        commandId: nextUlid(world),
        acceptedAt: nowIsoZ(world.clock),
        resolveBySec: RESOLVE_BY_SEC,
      });
    },
  };
}
