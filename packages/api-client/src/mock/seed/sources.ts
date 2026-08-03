import {
  zAudioControl, zChannelConfig, zLayoutPreset, zPhysicalInput, zSourceBinding,
  zSourceRole, zSourceStatus,
  type AudioControl, type ChannelConfig, type LayoutPreset, type PhysicalInput,
  type SourceBinding, type SourceRole, type SourceStatus,
} from '@eduscope/shared';
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

export function createSourcesSeed(): SourcesSeed {
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
      { roleId: 'students-cam', state: 'online', detail: null, inputId: null },
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
    ...boundRoleIds.map((roleId, i) =>
      validated(zSourceBinding, {
        roleId,
        physicalInputId: physicalInputs[i]!.id,
        enabled: true,
        updatedAt: SEED_EPOCH,
      }),
    ),
    validated(zSourceBinding, {
      roleId: 'mic-room',
      physicalInputId: null,
      enabled: false,
      updatedAt: SEED_EPOCH,
    }),
  ];

  // mic-lecturer only in V1 (LP-9) — appliedState is the truth the UI shows.
  const audioControls = [
    validated(zAudioControl, {
      roleId: 'mic-lecturer',
      gain: 72,
      muted: false,
      appliedState: 'applied',
      lastAppliedAt: SEED_EPOCH,
      lastError: null,
    }),
  ];

  // local (machine 1a's own consumer) is always on; meeting defaults to
  // cams-fifty-fifty per the content rule; streaming starts off.
  const channels = (
    [
      { channelId: 'local', alwaysOn: true, enabledByDefault: true, presetId: 'pc-only', ratioA: null, ratioB: null },
      { channelId: 'meeting', alwaysOn: false, enabledByDefault: false, presetId: 'cams-fifty-fifty', ratioA: 50, ratioB: 50 },
      { channelId: 'streaming', alwaysOn: false, enabledByDefault: false, presetId: 'fifty-fifty', ratioA: 50, ratioB: 50 },
    ] as const
  ).map((row) => validated(zChannelConfig, { ...row, streamTargetIds: null, updatedAt: SEED_EPOCH }));

  // Every preset's `allowedChannels` is a real subset, never the full
  // [local, meeting, streaming] list for every row (INV-LP-1).
  const layoutPresets: LayoutPreset[] = [
    validated(zLayoutPreset, {
      id: 'pc-only',
      displayName: 'Presentation only',
      description: 'Full-frame presentation capture, no cameras.',
      allowedChannels: ['local', 'meeting', 'streaming'],
      kind: 'single',
      canvas: { width: 1920, height: 1080 },
      tiles: [{ roleId: 'presentation', x: 0, y: 0, w: 1920, h: 1080, z: 0 }],
      parametric: false,
      outputs: [{ streamKey: 'main', roleIds: ['presentation'], includeAudio: true }],
      passthroughEligible: true,
      requiredRoles: ['presentation'],
    } satisfies LayoutPreset),
    validated(zLayoutPreset, {
      id: 'cam-1',
      displayName: 'Lecturer camera only',
      description: 'Full-frame lecturer camera, no slides.',
      allowedChannels: ['local', 'meeting', 'streaming'],
      kind: 'single',
      canvas: { width: 1920, height: 1080 },
      tiles: [{ roleId: 'lecturer-cam', x: 0, y: 0, w: 1920, h: 1080, z: 0 }],
      parametric: false,
      outputs: [{ streamKey: 'main', roleIds: ['lecturer-cam'], includeAudio: true }],
      passthroughEligible: true,
      requiredRoles: ['lecturer-cam'],
    } satisfies LayoutPreset),
    validated(zLayoutPreset, {
      id: 'cam-2',
      displayName: 'Students camera only',
      description: 'Full-frame students camera, no slides.',
      allowedChannels: ['local', 'meeting'],
      kind: 'single',
      canvas: { width: 1920, height: 1080 },
      tiles: [{ roleId: 'students-cam', x: 0, y: 0, w: 1920, h: 1080, z: 0 }],
      parametric: false,
      outputs: [{ streamKey: 'main', roleIds: ['students-cam'], includeAudio: true }],
      passthroughEligible: true,
      requiredRoles: ['students-cam'],
    } satisfies LayoutPreset),
    validated(zLayoutPreset, {
      id: 'fifty-fifty',
      displayName: 'Slides + lecturer, 50/50',
      description: 'Presentation and lecturer camera split evenly.',
      allowedChannels: ['local', 'meeting', 'streaming'],
      kind: 'composite',
      canvas: { width: 1920, height: 1080 },
      tiles: [
        { roleId: 'presentation', x: 0, y: 0, w: 960, h: 1080, z: 0 },
        { roleId: 'lecturer-cam', x: 960, y: 0, w: 960, h: 1080, z: 0 },
      ],
      parametric: true,
      outputs: [{ streamKey: 'main', roleIds: ['presentation', 'lecturer-cam'], includeAudio: true }],
      passthroughEligible: false,
      requiredRoles: ['presentation', 'lecturer-cam'],
    } satisfies LayoutPreset),
    validated(zLayoutPreset, {
      id: 'cams-fifty-fifty',
      displayName: 'Both cameras, 50/50',
      description: 'Lecturer and students cameras split evenly, no slides.',
      allowedChannels: ['local', 'meeting'],
      kind: 'composite',
      canvas: { width: 1920, height: 1080 },
      tiles: [
        { roleId: 'lecturer-cam', x: 0, y: 0, w: 960, h: 1080, z: 0 },
        { roleId: 'students-cam', x: 960, y: 0, w: 960, h: 1080, z: 0 },
      ],
      parametric: true,
      outputs: [{ streamKey: 'main', roleIds: ['lecturer-cam', 'students-cam'], includeAudio: true }],
      passthroughEligible: false,
      requiredRoles: ['lecturer-cam', 'students-cam'],
    } satisfies LayoutPreset),
    validated(zLayoutPreset, {
      id: 'side-by-side',
      displayName: 'Slides + students, side by side',
      description: 'Presentation and students camera side by side.',
      allowedChannels: ['local', 'streaming'],
      kind: 'composite',
      canvas: { width: 1920, height: 1080 },
      tiles: [
        { roleId: 'presentation', x: 0, y: 0, w: 1280, h: 1080, z: 0 },
        { roleId: 'students-cam', x: 1280, y: 0, w: 640, h: 1080, z: 0 },
      ],
      parametric: true,
      outputs: [{ streamKey: 'main', roleIds: ['presentation', 'students-cam'], includeAudio: true }],
      passthroughEligible: false,
      requiredRoles: ['presentation', 'students-cam'],
    } satisfies LayoutPreset),
    validated(zLayoutPreset, {
      id: 'separate-files',
      displayName: 'Separate files per source',
      description: 'Records each bound source to its own file — local recording only.',
      allowedChannels: ['local'],
      kind: 'multi-file',
      canvas: { width: 1920, height: 1080 },
      tiles: [
        { roleId: 'presentation', x: 0, y: 0, w: 1920, h: 1080, z: 0 },
        { roleId: 'lecturer-cam', x: 0, y: 0, w: 1920, h: 1080, z: 0 },
        { roleId: 'students-cam', x: 0, y: 0, w: 1920, h: 1080, z: 0 },
      ],
      parametric: false,
      outputs: [
        { streamKey: 'presentation', roleIds: ['presentation'], includeAudio: false },
        { streamKey: 'lecturer-cam', roleIds: ['lecturer-cam'], includeAudio: true },
        { streamKey: 'students-cam', roleIds: ['students-cam'], includeAudio: false },
      ],
      passthroughEligible: false,
      requiredRoles: ['presentation', 'lecturer-cam', 'students-cam'],
    } satisfies LayoutPreset),
  ];

  return { sourceRoles, sourceStatuses, physicalInputs, sourceBindings, audioControls, channels, layoutPresets };
}
