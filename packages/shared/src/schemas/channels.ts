import { z } from 'zod';
import { Instant, Ulid } from './primitives';
import {
  ChannelId,
  ChannelRuntimeState,
  LayoutKind,
  LayoutPresetId,
  SourceRoleId,
} from './enums';

/** Context A — layouts as data (domain model §4.10–4.11; kills B-01's 124-branch matrix). */

export const Tile = z.object({
  roleId: SourceRoleId,
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
  z: z.number().int(),
});
export type Tile = z.infer<typeof Tile>;

/** One produced file per entry for multi-file presets — the ~1/~2 successor (SEG-3). */
export const OutputSpec = z.object({
  streamKey: z.string().max(32), // e.g. composite, pc, cam1
  roleIds: z.array(SourceRoleId),
  includeAudio: z.boolean(),
});
export type OutputSpec = z.infer<typeof OutputSpec>;

/** Seeded reference data, defined once here and consumed by panel, contract and pipeline-manager (DM-6). */
export const LayoutPreset = z.object({
  id: LayoutPresetId,
  displayName: z.string().max(48),
  description: z.string().max(160),
  allowedChannels: z.array(ChannelId), // INV-LP-1
  kind: LayoutKind,
  canvas: z.object({ width: z.number().int(), height: z.number().int() }),
  tiles: z.array(Tile),
  parametric: z.boolean(), // geometry derives from ratioA/ratioB
  outputs: z.array(OutputSpec),
  passthroughEligible: z.boolean(), // INV-EP-2
  requiredRoles: z.array(SourceRoleId), // validated against SourceBinding (INV-SB-3)
});
export type LayoutPreset = z.infer<typeof LayoutPreset>;

/** Persisted per-channel configuration (domain model §4.11). Exactly three rows. */
export const ChannelConfig = z.object({
  channelId: ChannelId,
  alwaysOn: z.boolean(), // true for local only (INV-CC-1)
  enabledByDefault: z.boolean(),
  presetId: LayoutPresetId,
  ratioA: z.number().int().nullable(),
  ratioB: z.number().int().nullable(),
  streamTargetIds: z.array(Ulid).nullable(), // streaming only
  updatedAt: Instant,
});
export type ChannelConfig = z.infer<typeof ChannelConfig>;

/** Save is rejected with a named reason when INV-LP-1 / INV-SB-3 fail (INV-CC-3). */
export const ChannelConfigUpdate = z.object({
  enabledByDefault: z.boolean().optional(),
  presetId: LayoutPresetId.optional(),
  ratioA: z.number().int().nullable().optional(),
  ratioB: z.number().int().nullable().optional(),
  streamTargetIds: z.array(Ulid).nullable().optional(),
});
export type ChannelConfigUpdate = z.infer<typeof ChannelConfigUpdate>;

/** Runtime view for the panel switches (machine 1c + config). */
export const ChannelStatus = z.object({
  channelId: ChannelId,
  state: ChannelRuntimeState,
  presetId: LayoutPresetId,
  ratioA: z.number().int().nullable(),
  ratioB: z.number().int().nullable(),
  /** Named failure reason (CH-03/CH-06) — target unreachable, key rejected, element missing. */
  reason: z.string().nullable(),
});
export type ChannelStatus = z.infer<typeof ChannelStatus>;
