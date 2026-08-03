import {
  zCommandAccepted, zEncodingProfile, zNetworkConfig, zStreamTarget,
  type CommandAccepted, type EncoderCapabilities, type EncodingProfile,
  type EncodingProfileUpdate, type NetworkConfig, type NetworkConfigUpdate,
  type StreamTarget, type StreamTargetCreate, type StreamTargetUpdate, type Ulid,
} from '@eduscope/shared';
import { ProblemError } from '../../errors.js';
import { RESOLVE_BY_SEC } from '../commands.js';
import { validated, nowIsoZ } from '../seed/index.js';
import { nextUlid } from '../world.js';
import { requireAdmin } from './auth.js';
import type { RestContext } from './index.js';

export function createSettingsOperations(ctx: RestContext) {
  const { world, engine, seed } = ctx;

  return {
    listNetworkConfigs: async (): Promise<NetworkConfig[]> => {
      requireAdmin(ctx);
      return seed.networkConfigs.map((c) => validated(zNetworkConfig, c));
    },

    updateNetworkConfig: async (networkConfigId: Ulid, body: NetworkConfigUpdate): Promise<CommandAccepted> => {
      requireAdmin(ctx);
      const refusal = engine.onCommand('updateNetworkConfig');
      if (refusal) throw new ProblemError(refusal);
      const row = seed.networkConfigs.find((c) => c.id === networkConfigId);
      if (!row) throw new ProblemError({ status: 404, code: 'not-found', title: `Unknown network config: ${networkConfigId}` });
      Object.assign(row, {
        ...(body.kind !== undefined ? { kind: body.kind } : {}),
        ...(body.vlanId !== undefined ? { vlanId: body.vlanId } : {}),
        ...(body.addressMode !== undefined ? { addressMode: body.addressMode } : {}),
        ...(body.ipv4Address !== undefined ? { ipv4Address: body.ipv4Address } : {}),
        ...(body.prefixLength !== undefined ? { prefixLength: body.prefixLength } : {}),
        ...(body.gateway !== undefined ? { gateway: body.gateway } : {}),
        ...(body.dnsServers !== undefined ? { dnsServers: body.dnsServers } : {}),
        appliedAt: nowIsoZ(world.clock),
        lastApplyError: null,
      });
      return validated(zCommandAccepted, {
        commandId: nextUlid(world),
        acceptedAt: nowIsoZ(world.clock),
        resolveBySec: RESOLVE_BY_SEC,
      });
    },

    getEncoderSettings: async (): Promise<{ profile: EncodingProfile; capabilities: EncoderCapabilities }> => {
      requireAdmin(ctx);
      return {
        profile: validated(zEncodingProfile, seed.encoderSettings.profile),
        capabilities: seed.encoderSettings.capabilities,
      };
    },

    updateEncoderSettings: async (body: EncodingProfileUpdate): Promise<EncodingProfile> => {
      requireAdmin(ctx);
      const refusal = engine.onCommand('updateEncoderSettings');
      if (refusal) throw new ProblemError(refusal);
      const row = seed.encoderSettings.profile;
      const { min: bitrateMin, max: bitrateMax } = seed.encoderSettings.capabilities.videoBitrateKbps;
      if (
        body.videoBitrateKbps !== undefined &&
        (body.videoBitrateKbps < bitrateMin || body.videoBitrateKbps > bitrateMax)
      ) {
        throw new ProblemError({ status: 422, code: 'validation.invalid', title: "Bitrate is outside the encoder's capabilities" });
      }
      Object.assign(row, {
        ...(body.videoBitrateKbps !== undefined ? { videoBitrateKbps: body.videoBitrateKbps } : {}),
        ...(body.framerate !== undefined ? { framerate: body.framerate } : {}),
        ...(body.gop !== undefined ? { gop: body.gop } : {}),
        ...(body.rateControl !== undefined ? { rateControl: body.rateControl } : {}),
        ...(body.audioBitrateKbps !== undefined ? { audioBitrateKbps: body.audioBitrateKbps } : {}),
        capabilityVerifiedAt: nowIsoZ(world.clock),
      });
      return validated(zEncodingProfile, row);
    },

    listStreamTargets: async (): Promise<StreamTarget[]> => {
      requireAdmin(ctx);
      return seed.streamTargets.map((t) => validated(zStreamTarget, t));
    },

    createStreamTarget: async (body: StreamTargetCreate): Promise<StreamTarget> => {
      requireAdmin(ctx);
      const refusal = engine.onCommand('createStreamTarget');
      if (refusal) throw new ProblemError(refusal);
      // Stream keys never appear in any response (INV-ST-1) — body.streamKey
      // is deliberately not carried onto the stored row.
      const target = validated(zStreamTarget, {
        id: nextUlid(world),
        platform: body.platform,
        displayName: body.displayName,
        ingestUrl: body.ingestUrl,
        hasStreamKey: true,
        requiresTlsBridge: body.platform === 'custom-rtmp',
        enabled: body.enabled ?? true,
        lastPreflightAt: null,
        lastPreflightResult: null,
      });
      seed.streamTargets.push(target);
      return target;
    },

    updateStreamTarget: async (targetId: Ulid, body: StreamTargetUpdate): Promise<StreamTarget> => {
      requireAdmin(ctx);
      const refusal = engine.onCommand('updateStreamTarget');
      if (refusal) throw new ProblemError(refusal);
      const row = seed.streamTargets.find((t) => t.id === targetId);
      if (!row) throw new ProblemError({ status: 404, code: 'not-found', title: `Unknown stream target: ${targetId}` });
      Object.assign(row, {
        ...(body.platform !== undefined ? { platform: body.platform } : {}),
        ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
        ...(body.ingestUrl !== undefined ? { ingestUrl: body.ingestUrl } : {}),
        ...(body.streamKey !== undefined ? { hasStreamKey: true } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      });
      return validated(zStreamTarget, row);
    },

    deleteStreamTarget: async (targetId: Ulid): Promise<void> => {
      requireAdmin(ctx);
      const refusal = engine.onCommand('deleteStreamTarget');
      if (refusal) throw new ProblemError(refusal);
      const index = seed.streamTargets.findIndex((t) => t.id === targetId);
      if (index === -1) throw new ProblemError({ status: 404, code: 'not-found', title: `Unknown stream target: ${targetId}` });
      seed.streamTargets.splice(index, 1);
      return undefined;
    },
  };
}
