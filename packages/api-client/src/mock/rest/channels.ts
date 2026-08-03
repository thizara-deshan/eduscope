import {
  zChannelConfig, zChannelStatus, zCommandAccepted, zLayoutPreset,
  type ChannelConfig, type ChannelConfigUpdate, type ChannelStatus,
  type CommandAccepted, type LayoutPreset,
} from '@eduscope/shared';
import { ProblemError } from '../../errors.js';
import { channelTransitionId } from '../machines/index.js';
import type { Transition } from '../machines/types.js';
import { COMMAND_PLANS, RESOLVE_BY_SEC } from '../commands.js';
import { validated, nowIsoZ } from '../seed/index.js';
import { PAYLOAD_BUILDERS, nextUlid } from '../world.js';
import type { RestContext } from './index.js';

const fakeChannelTransition = (machine: 'channel:meeting' | 'channel:streaming'): Transition => ({
  id: 'snapshot', machine, from: [], to: null, effects: [], cite: 'C-9',
});

export function createChannelsOperations({ world, engine, seed }: RestContext) {
  function findChannel(channelId: string): ChannelConfig {
    const row = seed.channels.find((c) => c.channelId === channelId);
    if (!row) {
      throw new ProblemError({ status: 404, code: 'not-found', title: `Unknown channel: ${channelId}` });
    }
    return row;
  }

  return {
    listChannels: async (): Promise<ChannelStatus[]> => {
      const rows = seed.channels.map((c) => {
        if (c.channelId === 'local') {
          return validated(zChannelStatus, {
            channelId: 'local',
            state: 'on',
            presetId: c.presetId,
            ratioA: c.ratioA,
            ratioB: c.ratioB,
            reason: null,
          });
        }
        const machine = c.channelId === 'streaming' ? 'channel:streaming' : 'channel:meeting';
        return validated(
          zChannelStatus,
          PAYLOAD_BUILDERS['channel.state']!(world, fakeChannelTransition(machine)),
        );
      });
      return rows;
    },

    updateChannelConfig: async (channelId: string, body: ChannelConfigUpdate): Promise<ChannelConfig> => {
      const refusal = engine.onCommand('updateChannelConfig');
      if (refusal) throw new ProblemError(refusal);
      const row = findChannel(channelId);

      if (body.presetId) {
        const preset = seed.layoutPresets.find((p) => p.id === body.presetId);
        if (!preset || !preset.allowedChannels.includes(channelId as ChannelConfig['channelId'])) {
          throw new ProblemError({
            status: 422,
            code: 'config.invalid',
            title: `Preset ${String(body.presetId)} is not allowed on channel ${channelId}`,
          });
        }
      }

      Object.assign(row, {
        ...(body.enabledByDefault !== undefined ? { enabledByDefault: body.enabledByDefault } : {}),
        ...(body.presetId !== undefined ? { presetId: body.presetId } : {}),
        ...(body.ratioA !== undefined ? { ratioA: body.ratioA } : {}),
        ...(body.ratioB !== undefined ? { ratioB: body.ratioB } : {}),
        ...(body.streamTargetIds !== undefined ? { streamTargetIds: body.streamTargetIds } : {}),
        updatedAt: nowIsoZ(world.clock),
      });
      return validated(zChannelConfig, row);
    },

    // `local` is machine 1a's own consumer, not toggleable here (openapi.yaml:309);
    // an unknown channel id 404s via `findChannel`; idle (no active session)
    // answers 409 session.not-active per openapi.yaml:311-312, rather than
    // silently driving `channel:meeting`/`channel:streaming` regardless.
    enableChannel: async (channelId: string): Promise<CommandAccepted> => {
      const refusal = engine.onCommand('enableChannel');
      if (refusal) throw new ProblemError(refusal);
      if (channelId === 'local') {
        throw new ProblemError({
          status: 422,
          code: 'config.invalid',
          title: 'local is not toggleable — machine 1a owns it',
        });
      }
      findChannel(channelId);
      if (world.state('recording') === 'idle') {
        throw new ProblemError({
          status: 409,
          code: 'session.not-active',
          title: 'No active session — use PUT enabledByDefault instead',
        });
      }
      // CH-01 (streaming's own preflight entry) and CH-04 (meeting's direct
      // entry) are NOT the same doc id under a suffix — see channel.ts's own
      // module comment — so this is not a plain `channelTransitionId` resolve.
      const entry = channelId === 'streaming' ? 'CH-01' : channelTransitionId('meeting', 'CH-04');
      const afterMs = COMMAND_PLANS.enableChannel?.[0]?.afterMs ?? 150;
      world.schedule(entry, afterMs);
      return validated(zCommandAccepted, {
        commandId: nextUlid(world),
        acceptedAt: nowIsoZ(world.clock),
        resolveBySec: RESOLVE_BY_SEC,
      });
    },

    disableChannel: async (channelId: string): Promise<CommandAccepted> => {
      const refusal = engine.onCommand('disableChannel');
      if (refusal) throw new ProblemError(refusal);
      if (channelId === 'local') {
        throw new ProblemError({
          status: 422,
          code: 'config.invalid',
          title: 'local is not toggleable — machine 1a owns it',
        });
      }
      findChannel(channelId);
      const entry = channelTransitionId(channelId === 'streaming' ? 'streaming' : 'meeting', 'CH-07');
      const afterMs = COMMAND_PLANS.disableChannel?.[0]?.afterMs ?? 150;
      world.schedule(entry, afterMs);
      return validated(zCommandAccepted, {
        commandId: nextUlid(world),
        acceptedAt: nowIsoZ(world.clock),
        resolveBySec: RESOLVE_BY_SEC,
      });
    },

    listLayoutPresets: async (): Promise<LayoutPreset[]> =>
      seed.layoutPresets.map((p) => validated(zLayoutPreset, p)),
  };
}
