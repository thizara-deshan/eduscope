import type { FastifyInstance } from 'fastify';
import { eq, inArray } from 'drizzle-orm';
import { zChannelConfigUpdate, type ChannelConfig, type ChannelStatus } from '@eduscope/shared';
import { requireAuth } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import { ProblemError } from '../../contracts/problem.js';
import { parseBody } from '../../contracts/validate.js';
import type { DrizzleDb } from '../../db/client.js';
import { channelConfigs, layoutPresets, lectureSessions } from '../../db/schema.js';
import type { Clock } from '../../lib/clock.js';
import type { ChannelExecutor } from '../channels/machine.js';
import { resolveLayout } from './layouts.js';

const CHANNEL_IDS = ['local', 'meeting', 'streaming'] as const;
type SettingsChannelId = (typeof CHANNEL_IDS)[number];

const NON_TERMINAL_STATES = ['starting', 'recording', 'paused', 'stopping', 'finalizing'] as const;

function assertChannelId(channelId: string): SettingsChannelId {
  if (!(CHANNEL_IDS as readonly string[]).includes(channelId)) {
    throw new ProblemError(422, 'config.invalid', `Unknown channel: ${channelId}`);
  }
  return channelId as SettingsChannelId;
}

function toChannelConfigPayload(row: typeof channelConfigs.$inferSelect): ChannelConfig {
  return {
    channelId: row.channelId,
    alwaysOn: row.alwaysOn,
    enabledByDefault: row.enabledByDefault,
    presetId: row.presetId as ChannelConfig['presetId'],
    ratioA: row.ratioA,
    ratioB: row.ratioB,
    streamTargetIds: row.streamTargetIds,
    updatedAt: row.updatedAt,
  };
}

/** `local` mirrors machine 1a (design/core-api.md §11) — its runtime state is the active `LectureSession`, never a second source of truth. */
function localChannelStatus(db: DrizzleDb, config: typeof channelConfigs.$inferSelect): ChannelStatus {
  const session = db.select({ state: lectureSessions.state }).from(lectureSessions).where(inArray(lectureSessions.state, NON_TERMINAL_STATES)).get();
  let state: ChannelStatus['state'] = 'off';
  if (session) {
    if (session.state === 'starting') state = 'starting';
    else if (session.state === 'recording' || session.state === 'paused') state = 'on';
    else if (session.state === 'stopping' || session.state === 'finalizing') state = 'stopping';
  }
  return {
    channelId: 'local',
    state,
    presetId: config.presetId as ChannelStatus['presetId'],
    ratioA: config.ratioA,
    ratioB: config.ratioB,
    reason: null,
  };
}

export interface ChannelSettingsDeps {
  db: DrizzleDb;
  clock: Clock;
  channelExecutor: ChannelExecutor;
}

/** Registers this task's operationIds (openapi.yaml tag `channels`): `listChannels`, `updateChannelConfig`, `listLayoutPresets`. */
export function registerChannelSettingsRoutes(app: FastifyInstance, authService: AuthService, deps: ChannelSettingsDeps): void {
  app.get(
    '/api/v1/channels',
    { config: { operationId: 'listChannels' }, preHandler: requireAuth(authService, 'listChannels') },
    async (_request, reply) => {
      const configs = deps.db.select().from(channelConfigs).all();
      const runtimeStatuses = new Map(deps.channelExecutor.listStatuses().map((status) => [status.channelId, status]));

      const items = CHANNEL_IDS.map((channelId) => {
        const config = configs.find((row) => row.channelId === channelId)!;
        const status = channelId === 'local' ? localChannelStatus(deps.db, config) : runtimeStatuses.get(channelId)!;
        return { config: toChannelConfigPayload(config), status };
      });
      reply.code(200).send({ items });
    },
  );

  app.get(
    '/api/v1/layouts',
    { config: { operationId: 'listLayoutPresets' }, preHandler: requireAuth(authService, 'listLayoutPresets') },
    async (_request, reply) => {
      const items = deps.db.select().from(layoutPresets).all();
      reply.code(200).send({ items });
    },
  );

  app.put(
    '/api/v1/channels/:channelId',
    { config: { operationId: 'updateChannelConfig' }, preHandler: requireAuth(authService, 'updateChannelConfig') },
    async (request, reply) => {
      const { channelId } = request.params as { channelId: string };
      const id = assertChannelId(channelId);
      const patch = parseBody(zChannelConfigUpdate, request.body);

      const current = deps.db.select().from(channelConfigs).where(eq(channelConfigs.channelId, id)).get();
      if (!current) {
        throw new ProblemError(422, 'config.invalid', `The ${id} channel is not configured`);
      }

      // INV-CC-1: `local` is always on; nothing can turn that off.
      if (id === 'local' && patch.enabledByDefault === false) {
        throw new ProblemError(422, 'config.invalid', 'The local channel is always on and cannot be disabled');
      }

      const nextPresetId = patch.presetId ?? current.presetId;
      const nextRatioA = patch.ratioA !== undefined ? patch.ratioA : current.ratioA;
      const nextRatioB = patch.ratioB !== undefined ? patch.ratioB : current.ratioB;
      const nextStreamTargetIds = patch.streamTargetIds !== undefined ? patch.streamTargetIds : current.streamTargetIds;

      // Stream targets apply only to `streaming` (openapi.yaml updateChannelConfig description).
      if (id !== 'streaming' && nextStreamTargetIds !== null && nextStreamTargetIds.length > 0) {
        throw new ProblemError(422, 'config.invalid', 'streamTargetIds only apply to the streaming channel');
      }
      // streamTargetIds require admin (openapi.yaml updateChannelConfig description).
      if (patch.streamTargetIds !== undefined && request.authContext!.role !== 'admin') {
        throw new ProblemError(422, 'config.invalid', 'streamTargetIds require admin');
      }

      resolveLayout(deps.db, id, nextPresetId, { ratioA: nextRatioA, ratioB: nextRatioB });

      deps.db
        .update(channelConfigs)
        .set({
          enabledByDefault: patch.enabledByDefault ?? current.enabledByDefault,
          presetId: nextPresetId,
          ratioA: nextRatioA,
          ratioB: nextRatioB,
          streamTargetIds: nextStreamTargetIds,
          updatedAt: deps.clock.now().toISOString(),
          updatedBy: request.authContext!.userId,
        })
        .where(eq(channelConfigs.channelId, id))
        .run();

      const updated = deps.db.select().from(channelConfigs).where(eq(channelConfigs.channelId, id)).get()!;
      reply.code(200).send(toChannelConfigPayload(updated));
    },
  );
}
