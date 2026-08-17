import {
  LAYOUT_PRESETS,
  zAudioControl, zChannelConfig, zPhysicalInput, zSourceBinding,
  zSourceRole, zSourceStatus,
  type AudioControl, type ChannelConfig, type LayoutPreset, type PhysicalInput,
  type SourceBinding, type SourceRole, type SourceStatus, type StreamTarget,
} from '@eduscope/shared';
import type { WorldSeed } from '../scenario/types.js';
import { SEED_EPOCH, seedId, validated } from './index.js';

export interface SourcesSeed {
  readonly sourceRoles: SourceRole[];
  readonly sourceStatuses: SourceStatus[];
  readonly physicalInputs: PhysicalInput[];
  readonly sourceBindings: SourceBinding[];
  readonly audioControls: AudioControl[];
  readonly channels: ChannelConfig[];
  readonly layoutPresets: LayoutPreset[];
}

/**
 * `streamTargets` is device.ts's fixture — threaded in rather than
 * regenerated so streaming's `streamTargetIds` and `/settings/stream-targets`
 * always agree on one id list (W3-D plan, "Fix seed truth once").
 */
export function createSourcesSeed(
  overrides: Partial<WorldSeed> = {},
  streamTargets: readonly StreamTarget[] = [],
): SourcesSeed {
  const applyFails = overrides.audioApplyFails ?? false;
  const studentsCameraBound = overrides.studentsCameraBound ?? true;
  const sourceRoles = (
    [
      { id: 'presentation', medium: 'video', displayLabel: 'Presentation', requiredForStart: true, provisionable: true },
      { id: 'lecturer-cam', medium: 'video', displayLabel: 'Lecturer Camera', requiredForStart: true, provisionable: true },
      { id: 'students-cam', medium: 'video', displayLabel: 'Students Camera', requiredForStart: false, provisionable: true },
      { id: 'mic-lecturer', medium: 'audio', displayLabel: 'Lecturer Mic', requiredForStart: true, provisionable: true },
      { id: 'mic-room', medium: 'audio', displayLabel: 'Room Mic', requiredForStart: false, provisionable: false },
    ] as const
  ).map((row) => validated(zSourceRole, row));

  // Four bound roles are all `online`; `mic-room` is seeded `unbound` and
  // stays that way (INV-SR-2) — `rest/sources.ts`'s getSourcesStatus prefers
  // the live per-role machine for the four bound roles and falls back to
  // this row only for mic-room, which has no registered machine instance.
  const sourceStatuses = (
    [
      { roleId: 'presentation', state: 'online', detail: null, inputId: null },
      { roleId: 'lecturer-cam', state: 'online', detail: null, inputId: null },
      { roleId: 'students-cam', state: studentsCameraBound ? 'online' : 'unbound', detail: null, inputId: null },
      { roleId: 'mic-lecturer', state: 'online', detail: null, inputId: null },
      { roleId: 'mic-room', state: 'unbound', detail: null, inputId: null },
    ] as const
  ).map((row) => validated(zSourceStatus, { ...row, since: SEED_EPOCH }));

  const physicalInputs = (
    [
      { kind: 'rtsp', address: 'rtsp://10.20.4.30/presentation', expectedCodec: 'h264', transport: 'tcp' },
      { kind: 'v4l2', address: '/dev/video0', expectedCodec: 'raw-nv12', transport: null },
      { kind: 'v4l2', address: '/dev/video1', expectedCodec: 'raw-nv12', transport: null },
      { kind: 'alsa', address: 'hw:1,0', expectedCodec: 's16le', transport: null },
    ] as const
  ).map((row) =>
    validated(zPhysicalInput, {
      id: seedId('input'),
      credentialRef: null,
      stableIdentifier: null,
      presenceState: 'present',
      lastSeenAt: SEED_EPOCH,
      updatedAt: SEED_EPOCH,
      ...row,
    }),
  );

  const boundRoleIds = ['presentation', 'lecturer-cam', 'students-cam', 'mic-lecturer'] as const;
  const sourceBindings = [
    ...boundRoleIds.map((roleId, i) => {
      const unbound = roleId === 'students-cam' && !studentsCameraBound;
      return validated(zSourceBinding, {
        roleId,
        physicalInputId: unbound ? null : physicalInputs[i]!.id,
        enabled: !unbound,
        updatedAt: SEED_EPOCH,
      });
    }),
    validated(zSourceBinding, {
      roleId: 'mic-room',
      physicalInputId: null,
      enabled: false,
      updatedAt: SEED_EPOCH,
    }),
  ];

  // mic-lecturer only in V1 (LP-9) — appliedState is the truth the UI shows.
  // `audioApplyFails` seeds the world already in the failed state so S-11 §5.1
  // state 4 renders on FIRST paint, not only after a round trip (W2-D-4).
  const audioControls = [
    validated(zAudioControl, {
      roleId: 'mic-lecturer',
      gain: 72,
      muted: false,
      appliedState: applyFails ? 'failed' : 'applied',
      lastAppliedAt: SEED_EPOCH,
      lastError: applyFails ? 'The mixer did not accept the change.' : null,
    }),
  ];

  // local (machine 1a's own consumer) is always on and defaults to
  // fifty-fifty (LP-7); meeting defaults to cams-fifty-fifty per the content
  // rule; streaming starts off, pre-wired to every enabled seeded target.
  const enabledStreamTargetIds = streamTargets.filter((t) => t.enabled).map((t) => t.id);
  const channels = (
    [
      { channelId: 'local', alwaysOn: true, enabledByDefault: true, presetId: 'fifty-fifty', ratioA: 50, ratioB: 50, streamTargetIds: null },
      { channelId: 'meeting', alwaysOn: false, enabledByDefault: false, presetId: 'cams-fifty-fifty', ratioA: 50, ratioB: 50, streamTargetIds: null },
      { channelId: 'streaming', alwaysOn: false, enabledByDefault: false, presetId: 'fifty-fifty', ratioA: 50, ratioB: 50, streamTargetIds: enabledStreamTargetIds },
    ] as const
  ).map((row) => validated(zChannelConfig, { ...row, updatedAt: SEED_EPOCH }));

  // Sourced from the one shared even-16:9 catalog (A-03 gate correction) —
  // every preset's `allowedChannels` is a real subset, never the full
  // [local, meeting, streaming] list for every row (INV-LP-1).
  const layoutPresets: LayoutPreset[] = LAYOUT_PRESETS.slice();

  return { sourceRoles, sourceStatuses, physicalInputs, sourceBindings, audioControls, channels, layoutPresets };
}
