import { LAYOUT_PRESETS } from '@eduscope/shared';
import { eq } from 'drizzle-orm';
import type { IdGenerator } from '../lib/ids.js';
import type { CoreDatabase } from './client.js';
import {
  channelConfigs,
  encodingProfiles,
  physicalInputs,
  retentionPolicy,
  sourceBindings,
  sourceRoles,
  layoutPresets,
} from './schema.js';

const SOURCE_ROLES = [
  { id: 'presentation', medium: 'video', displayLabel: 'PC', requiredForStart: false, provisionable: true },
  { id: 'lecturer-cam', medium: 'video', displayLabel: 'CAM 1', requiredForStart: false, provisionable: true },
  { id: 'students-cam', medium: 'video', displayLabel: 'CAM 2', requiredForStart: false, provisionable: true },
  { id: 'mic-lecturer', medium: 'audio', displayLabel: 'Lecturer Mic', requiredForStart: false, provisionable: true },
  { id: 'mic-room', medium: 'audio', displayLabel: 'Room Mic', requiredForStart: false, provisionable: false },
] as const;

const CHANNEL_CONFIGS = [
  { channelId: 'local', alwaysOn: true, enabledByDefault: true, presetId: 'fifty-fifty', ratioA: 50, ratioB: 50 },
  {
    channelId: 'meeting',
    alwaysOn: false,
    enabledByDefault: false,
    presetId: 'cams-fifty-fifty',
    ratioA: 50,
    ratioB: 50,
  },
  { channelId: 'streaming', alwaysOn: false, enabledByDefault: false, presetId: 'pc-only', ratioA: null, ratioB: null },
] as const;

/** Provisionable roles only (INV-SR-2 — `mic-room` has no `SourceBinding` in V1). */
const PHYSICAL_INPUT_SKELETONS = [
  { roleId: 'presentation', kind: 'v4l2', address: '/dev/video0' },
  { roleId: 'lecturer-cam', kind: 'rtsp', address: 'rtsp://192.168.1.101/stream1' },
  { roleId: 'students-cam', kind: 'rtsp', address: 'rtsp://192.168.1.102/stream1' },
  { roleId: 'mic-lecturer', kind: 'alsa', address: 'hw:0,0' },
] as const;

/**
 * Idempotent upserts (design/core-api.md §3.3): closed-enum tables key on their
 * natural PK; ulid-keyed skeletons key on the natural discriminator that owns
 * them (role, scope) so re-seeding never depends on a freshly generated id.
 */
export function seed(core: CoreDatabase, now: Date, ids: IdGenerator): void {
  const nowIso = now.toISOString();

  for (const role of SOURCE_ROLES) {
    core.db.insert(sourceRoles).values(role).onConflictDoNothing().run();
  }

  for (const preset of LAYOUT_PRESETS) {
    core.db
      .insert(layoutPresets)
      .values({
        id: preset.id,
        displayName: preset.displayName,
        description: preset.description,
        allowedChannels: preset.allowedChannels,
        kind: preset.kind,
        canvas: preset.canvas,
        tiles: preset.tiles,
        parametric: preset.parametric,
        outputs: preset.outputs,
        passthroughEligible: preset.passthroughEligible,
        requiredRoles: preset.requiredRoles,
      })
      .onConflictDoNothing()
      .run();
  }

  for (const channel of CHANNEL_CONFIGS) {
    core.db
      .insert(channelConfigs)
      .values({
        channelId: channel.channelId,
        alwaysOn: channel.alwaysOn,
        enabledByDefault: channel.enabledByDefault,
        presetId: channel.presetId,
        ratioA: channel.ratioA,
        ratioB: channel.ratioB,
        streamTargetIds: channel.channelId === 'streaming' ? [] : null,
        updatedAt: nowIso,
      })
      .onConflictDoNothing()
      .run();
  }

  for (const skeleton of PHYSICAL_INPUT_SKELETONS) {
    const existingBinding = core.db
      .select()
      .from(sourceBindings)
      .where(eq(sourceBindings.roleId, skeleton.roleId))
      .get();
    if (existingBinding) continue;

    const physicalInputId = ids.next(now);
    core.db
      .insert(physicalInputs)
      .values({
        id: physicalInputId,
        kind: skeleton.kind,
        address: skeleton.address,
        presenceState: 'unknown',
        updatedAt: nowIso,
      })
      .run();
    core.db
      .insert(sourceBindings)
      .values({
        roleId: skeleton.roleId,
        physicalInputId,
        enabled: true,
        updatedAt: nowIso,
      })
      .run();
  }

  core.db
    .insert(retentionPolicy)
    .values({
      id: 'retention-policy',
      maxAgeDays: 14,
      warningThresholdPct: 80,
      criticalThresholdPct: 95,
      earlyDeleteOrder: 'uploaded-oldest-first',
      neverDeleteUnuploaded: true,
      refuseStartWhenCritical: true,
    })
    .onConflictDoNothing()
    .run();

  const existingDefaultProfile = core.db
    .select()
    .from(encodingProfiles)
    .where(eq(encodingProfiles.scope, 'device-default'))
    .get();
  if (!existingDefaultProfile) {
    core.db
      .insert(encodingProfiles)
      .values({
        id: ids.next(now),
        scope: 'device-default',
        videoBitrateKbps: 4000,
        framerate: 30,
        gop: 60,
        rateControl: 'cbr',
        codec: 'h264',
        container: 'mpegts',
        audioCodec: 'aac',
        audioBitrateKbps: 128,
      })
      .run();
  }
}
