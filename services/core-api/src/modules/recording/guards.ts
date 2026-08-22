import { readFileSync } from 'node:fs';
import type { LayoutPresetId } from '@eduscope/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { ProblemError } from '../../contracts/problem.js';
import type { DrizzleDb } from '../../db/client.js';
import {
  channelConfigs,
  deviceHealth,
  layoutPresets,
  lectureSessions,
  physicalInputs,
  sourceBindings,
  sourceRoles,
  storageVolumes,
  users,
} from '../../db/schema.js';

/** R-01's non-terminal vocabulary — the same set the `one_active_session` partial unique index enforces (INV-LS-1). */
const NON_TERMINAL_STATES = ['starting', 'recording', 'paused', 'stopping', 'finalizing'] as const;

export interface DeviceProvisioningSnapshot {
  deviceId: string;
  hallCode: string;
  hallDisplayName: string;
  titlePattern: string;
}

/**
 * Only the fields R-01 needs from `DeviceProvisioning` (domain-model.md §4.1).
 * `.passthrough()` so later tasks that read more of this deploy-owned file
 * (B-21 `getProvisioning`, B-29 `llmEndpoint`, ...) don't need a shape here.
 */
const zProvisioningFile = z
  .object({
    deviceId: z.string().min(1),
    hallCode: z.string().min(1),
    hallDisplayName: z.string().min(1),
    titlePattern: z.string().min(1),
  })
  .passthrough();

/** G-PROVISIONED (INV-DP-2). core-api never writes this file (INV-DP-1) — it only reads it, per use. */
export function readProvisioning(provisioningPath: string): DeviceProvisioningSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(provisioningPath, 'utf8'));
  } catch {
    throw new ProblemError(422, 'provisioning.incomplete', 'Device is not provisioned', {
      detail: 'missing or unreadable provisioning file',
    });
  }
  const result = zProvisioningFile.safeParse(parsed);
  if (!result.success) {
    throw new ProblemError(422, 'provisioning.incomplete', 'Device is not provisioned', {
      detail: 'incomplete provisioning file',
    });
  }
  return result.data;
}

/** G-NO-ACTIVE-SESSION (INV-LS-1). Refusal names the current owner/title for the LP-6 locked view (R-03). */
export function assertNoActiveSession(db: DrizzleDb, deviceId: string): void {
  const active = db
    .select({ id: lectureSessions.id, title: lectureSessions.title, ownerUserId: lectureSessions.ownerUserId })
    .from(lectureSessions)
    .where(and(eq(lectureSessions.deviceId, deviceId), inArray(lectureSessions.state, NON_TERMINAL_STATES)))
    .get();
  if (!active) return;

  const owner = db.select({ displayName: users.displayName }).from(users).where(eq(users.id, active.ownerUserId)).get();
  throw new ProblemError(409, 'recorder.busy', 'A recording is already in progress', {
    meta: { ownerDisplayName: owner?.displayName ?? null, title: active.title },
  });
}

/** G-VOLUME-MOUNTED (INV-SV-1). */
export function assertVolumeMounted(db: DrizzleDb): void {
  const mounted = db
    .select({ id: storageVolumes.id })
    .from(storageVolumes)
    .where(and(eq(storageVolumes.role, 'recordings'), eq(storageVolumes.state, 'mounted')))
    .get();
  if (!mounted) {
    throw new ProblemError(422, 'volume.unavailable', 'No recordings volume is mounted');
  }
}

/**
 * G-STORAGE-OK (INV-DH-3, `[D-15]`). B-19/B-21 own the continuous storage
 * probe keeps `device_health` fresh and persists probe failures as critical.
 * B-21 owns the durable health seed, so pre-B-21 databases may have no row.
 */
export function assertStorageOk(db: DrizzleDb): void {
  const health = db.select({ storagePressure: deviceHealth.storagePressure }).from(deviceHealth).where(eq(deviceHealth.id, 'device-health')).get();
  if (health?.storagePressure === 'critical') {
    throw new ProblemError(422, 'storage.critical', 'Storage is critically low');
  }
}

export type SourceSnapshot = Record<string, { inputId: string | null; address: string | null }>;

export interface ChannelValidResult {
  channelConfig: typeof channelConfigs.$inferSelect;
  layoutPreset: typeof layoutPresets.$inferSelect;
  sourceSnapshot: SourceSnapshot;
}

/** G-CHANNEL-VALID (INV-LP-1, INV-SB-3) for the always-on `local` channel — the only one B-05 starts. */
export function resolveChannelValid(db: DrizzleDb): ChannelValidResult {
  const channelConfig = db.select().from(channelConfigs).where(eq(channelConfigs.channelId, 'local')).get();
  if (!channelConfig) {
    throw new ProblemError(422, 'config.invalid', 'The local channel is not configured');
  }

  const layoutPreset = db
    .select()
    .from(layoutPresets)
    .where(eq(layoutPresets.id, channelConfig.presetId as LayoutPresetId))
    .get();
  if (!layoutPreset) {
    throw new ProblemError(422, 'config.invalid', 'The configured preset does not exist', {
      meta: { presetId: channelConfig.presetId },
    });
  }
  if (!layoutPreset.allowedChannels.includes('local')) {
    throw new ProblemError(422, 'config.invalid', 'The configured preset is not allowed on the local channel', {
      meta: { presetId: layoutPreset.id },
    });
  }

  const roles = db.select().from(sourceRoles).all();
  const bindings = db.select().from(sourceBindings).all();
  const inputs = db.select().from(physicalInputs).all();
  const bindingByRole = new Map(bindings.map((binding) => [binding.roleId, binding]));
  const inputById = new Map(inputs.map((input) => [input.id, input]));

  const sourceSnapshot: SourceSnapshot = {};
  for (const role of roles) {
    const binding = bindingByRole.get(role.id);
    const input = binding?.physicalInputId ? inputById.get(binding.physicalInputId) : undefined;
    sourceSnapshot[role.id] =
      binding?.enabled && binding.physicalInputId !== null && input
        ? { inputId: binding.physicalInputId, address: input.address }
        : { inputId: null, address: null };
  }

  for (const roleId of layoutPreset.requiredRoles) {
    if (sourceSnapshot[roleId]?.inputId === null || sourceSnapshot[roleId] === undefined) {
      throw new ProblemError(422, 'config.invalid', 'A required source role is unbound', { meta: { roleId } });
    }
  }

  return { channelConfig, layoutPreset, sourceSnapshot };
}

/** G-AUTH-OWNER (INV-LS-2): only the session's owner or an admin may pause, resume, stop, or take over. */
export function assertAuthOwner(session: { ownerUserId: string }, actor: { userId: string; role: 'lecturer' | 'admin' }): void {
  if (actor.role === 'admin' || actor.userId === session.ownerUserId) return;
  throw new ProblemError(403, 'not-authorized', 'Only the recording owner or an admin may do this');
}

export interface StartGuardResult {
  provisioning: DeviceProvisioningSnapshot;
  channel: ChannelValidResult;
}

/** Runs every R-01 Class A guard in the order that makes each predicate's inputs available; a refusal here creates no session (state-machines.md §0.4). */
export function runStartGuards(db: DrizzleDb, provisioningPath: string): StartGuardResult {
  const provisioning = readProvisioning(provisioningPath);
  assertNoActiveSession(db, provisioning.deviceId);
  assertVolumeMounted(db);
  assertStorageOk(db);
  const channel = resolveChannelValid(db);
  return { provisioning, channel };
}
