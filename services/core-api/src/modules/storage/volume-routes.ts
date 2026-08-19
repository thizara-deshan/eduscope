import type { CommandAccepted, StorageVolume } from '@eduscope/shared';
import { TIMERS, zFormatVolumeRequest, zRegisterVolumeRequest } from '@eduscope/shared';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { ProblemError } from '../../contracts/problem.js';
import { parseBody } from '../../contracts/validate.js';
import type { DrizzleDb } from '../../db/client.js';
import { lectureSessions, storageVolumes } from '../../db/schema.js';
import type { Clock } from '../../lib/clock.js';
import type { HelperClient } from '../../lib/helper-client.js';
import type { IdGenerator } from '../../lib/ids.js';
import { requireAuth } from '../auth/guard.js';
import type { AuthContext, AuthService } from '../auth/service.js';

const NON_TERMINAL_STATES = ['starting', 'recording', 'paused', 'stopping', 'finalizing'] as const;

export interface StorageBlockDevice {
  uuid: string;
  devNode: string;
  mountPath: string;
  label: string | null;
  filesystem: string;
  capacityBytes: number;
  freeBytes: number;
}

export interface StorageBlockDeviceResolver {
  resolveUuid(uuid: string): Promise<StorageBlockDevice | null>;
}

export interface StorageVolumeRoutesDeps {
  db: DrizzleDb;
  clock: Clock;
  ids: IdGenerator;
  helper: HelperClient;
  blockDevices: StorageBlockDeviceResolver;
}

function assertAdmin(actor: AuthContext): void {
  if (actor.role !== 'admin') throw new ProblemError(403, 'not-authorized', 'Administrator role required');
}

function toVolume(row: typeof storageVolumes.$inferSelect): StorageVolume {
  return {
    id: row.id,
    uuid: row.uuid,
    devicePath: row.devicePath,
    mountPath: row.mountPath,
    label: row.label,
    filesystem: row.filesystem,
    capacityBytes: Number(row.capacityBytes),
    freeBytes: Number(row.freeBytes),
    smartStatus: row.smartStatus,
    role: row.role,
    state: row.state,
    registeredAt: row.registeredAt,
  };
}

function accepted(deps: StorageVolumeRoutesDeps): CommandAccepted {
  const now = deps.clock.now();
  return { commandId: deps.ids.next(now), acceptedAt: now.toISOString(), resolveBySec: TIMERS['T-CMD-RESOLVE'] / 1000 };
}

async function registerVolume(deps: StorageVolumeRoutesDeps, actor: AuthContext, body: unknown): Promise<StorageVolume> {
  assertAdmin(actor);
  const input = parseBody(zRegisterVolumeRequest.strict(), body);
  const existing = deps.db.select().from(storageVolumes).where(eq(storageVolumes.uuid, input.uuid)).get();
  if (existing) throw new ProblemError(409, 'conflict', 'Storage volume UUID is already registered');

  await deps.helper.request('volume.mount', { uuid: input.uuid }, deps.ids.next(deps.clock.now()));
  const current = await deps.blockDevices.resolveUuid(input.uuid);
  const now = deps.clock.now();
  const id = deps.ids.next(now);
  deps.db.insert(storageVolumes).values({
    id,
    uuid: input.uuid,
    devicePath: current?.devNode ?? '',
    mountPath: current?.mountPath ?? `/media/eduscope/${input.uuid}`,
    label: input.label ?? current?.label ?? null,
    filesystem: current?.filesystem ?? 'unknown',
    capacityBytes: current?.capacityBytes ?? 0,
    freeBytes: current?.freeBytes ?? 0,
    smartStatus: 'unknown',
    role: 'recordings',
    state: current ? 'mounted' : 'missing',
    registeredAt: now.toISOString(),
    registeredBy: actor.userId,
  }).run();
  return toVolume(deps.db.select().from(storageVolumes).where(eq(storageVolumes.id, id)).get()!);
}

async function formatVolume(deps: StorageVolumeRoutesDeps, actor: AuthContext, volumeId: string, body: unknown): Promise<CommandAccepted> {
  assertAdmin(actor);
  const input = parseBody(zFormatVolumeRequest.strict(), body);
  const row = deps.db.select().from(storageVolumes).where(eq(storageVolumes.id, volumeId)).get();
  if (!row) throw new ProblemError(422, 'volume.unavailable', 'Storage volume is not registered');
  if (input.confirmText !== (row.label ?? row.uuid)) throw new ProblemError(422, 'validation.invalid', 'Confirmation text does not name the volume');
  const active = deps.db.select({ id: lectureSessions.id }).from(lectureSessions).where(inArray(lectureSessions.state, NON_TERMINAL_STATES)).get();
  if (active) throw new ProblemError(409, 'format.refused', 'A recording is active');
  const current = await deps.blockDevices.resolveUuid(row.uuid);
  if (!current || current.devNode !== row.devicePath) throw new ProblemError(422, 'volume.unavailable', 'Registered device node is not a current block device');

  const requestAt = deps.clock.now();
  await deps.helper.request('volume.unmount', { uuid: row.uuid }, deps.ids.next(requestAt));
  await deps.helper.request('volume.format', { devNode: current.devNode, fs: 'ext4', label: row.label ?? row.uuid }, deps.ids.next(requestAt));
  await deps.helper.request('volume.mount', { uuid: row.uuid }, deps.ids.next(requestAt));
  const refreshed = await deps.blockDevices.resolveUuid(row.uuid);
  deps.db.update(storageVolumes).set({
    devicePath: refreshed?.devNode ?? current.devNode,
    mountPath: refreshed?.mountPath ?? current.mountPath,
    filesystem: 'ext4',
    capacityBytes: refreshed?.capacityBytes ?? current.capacityBytes,
    freeBytes: refreshed?.freeBytes ?? current.freeBytes,
    state: refreshed ? 'mounted' : 'missing',
  }).where(eq(storageVolumes.id, volumeId)).run();
  return accepted(deps);
}

export function registerStorageVolumeRoutes(app: FastifyInstance, authService: AuthService, deps: StorageVolumeRoutesDeps): void {
  app.post('/api/v1/storage/volumes', { config: { operationId: 'registerStorageVolume' }, preHandler: requireAuth(authService, 'registerStorageVolume') }, async (request, reply) => {
    reply.code(201).send(await registerVolume(deps, request.authContext!, request.body));
  });
  app.post('/api/v1/storage/volumes/:volumeId/format', { config: { operationId: 'formatStorageVolume' }, preHandler: requireAuth(authService, 'formatStorageVolume') }, async (request, reply) => {
    const { volumeId } = request.params as { volumeId: string };
    reply.code(202).send(await formatVolume(deps, request.authContext!, volumeId, request.body));
  });
}
