import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { zRegisterStorageVolumeResponse, zFormatStorageVolumeResponse } from '@eduscope/shared';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { lectureSessions, storageVolumes, users } from '../../src/db/schema.js';
import { HelperClient, UnixHelperTransport } from '../../src/lib/helper-client.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import type { StorageBlockDevice, StorageBlockDeviceResolver } from '../../src/modules/storage/volume-routes.js';
import { FakeClock } from '../fakes/clock.js';
import { InMemoryHelperTransport, startFakeHelperServer } from '../fakes/helper-server.js';
import { FakePipelineManager } from '../fakes/pipeline-manager.js';

const NOW = new Date('2026-08-19T00:00:00.000Z');
const dirs: string[] = [];
const apps: Array<Awaited<ReturnType<typeof buildApp>>> = [];
const managers: FakePipelineManager[] = [];

class Resolver implements StorageBlockDeviceResolver {
  current: StorageBlockDevice | null = { uuid: 'vol-1', devNode: '/dev/sdb1', mountPath: '/media/eduscope/vol-1', label: 'LectureDisk', filesystem: 'ext4', capacityBytes: 1000, freeBytes: 900 };
  async resolveUuid(uuid: string) { return this.current?.uuid === uuid ? this.current : null; }
}

async function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'core-volumes-')); dirs.push(dir);
  const pm = new FakePipelineManager({ bearerToken: 'volume-bearer' }); managers.push(pm);
  const clock = new FakeClock(NOW);
  const ids = new UlidGenerator();
  const helperTransport = new InMemoryHelperTransport();
  const resolver = new Resolver();
  const app = await buildApp({
    config: loadConfig({ NODE_ENV: 'test', CORE_API_DB_PATH: join(dir, 'core.db'), CORE_API_RECORDINGS_ROOT: join(dir, 'recordings'), CORE_API_PM_BASE_URL: await pm.listen(), CORE_API_INTERNAL_BEARER: 'volume-bearer', CORE_API_JWT_SECRET: 'volume-secret', CORE_API_HELPER_SOCKET: join(dir, 'never-production.sock') }),
    clock,
    ids,
    helperTransport,
    storageBlockDevices: resolver,
    storageStatfs: async () => ({ totalBytes: 1000, freeBytes: 900 }),
  });
  await app.lifecycle.start(); apps.push(app);
  const adminId = ids.next(NOW); const lecturerId = ids.next(NOW);
  await app.db.insert(users).values([
    { id: adminId, username: 'volume-admin', displayName: 'Admin', role: 'admin', source: 'local', passwordHash: await hashPassword('Password1'), mustResetPassword: false, disabled: false, createdAt: NOW.toISOString() },
    { id: lecturerId, username: 'volume-lecturer', displayName: 'Lecturer', role: 'lecturer', source: 'local', passwordHash: await hashPassword('Password1'), mustResetPassword: false, disabled: false, createdAt: NOW.toISOString() },
  ]).run();
  async function token(username: string) {
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password: 'Password1', client: 'admin' } });
    return (response.json() as { tokens: { accessToken: string } }).tokens.accessToken;
  }
  return { app, clock, ids, helperTransport, resolver, adminId, lecturerId, token };
}

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const pm of managers.splice(0)) await pm.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('HelperClient closed protocol', () => {
  it('rejects unknown verbs, extra args, and path-like metacharacters before transport', async () => {
    const transport = new InMemoryHelperTransport();
    const client = new HelperClient({ transport, clock: new FakeClock(NOW) });
    await expect(client.request('arbitrary.exec' as never, {} as never, 'req-1')).rejects.toMatchObject({ code: 'validation.invalid' });
    await expect(client.request('volume.mount', { uuid: 'vol-1', extra: true } as never, 'req-2')).rejects.toMatchObject({ code: 'validation.invalid' });
    await expect(client.request('volume.format', { devNode: '/dev/sdb1;rm', fs: 'ext4', label: 'Disk' }, 'req-3')).rejects.toMatchObject({ code: 'validation.invalid' });
    expect(transport.ledger).toEqual([]);
  });

  it('times out and aborts a hung helper request', async () => {
    const transport = new InMemoryHelperTransport(); transport.hang = true;
    const clock = new FakeClock(NOW);
    const client = new HelperClient({ transport, clock, timeoutMs: 100 });
    const pending = client.request('volume.mount', { uuid: 'vol-1' }, 'req-timeout');
    clock.advance(100);
    await expect(pending).rejects.toMatchObject({ code: 'volume.unavailable' });
  });
});

describe('storage volume routes', () => {
  it('registers by UUID once and calls only volume.mount', async () => {
    const h = await harness(); const token = await h.token('volume-admin');
    const response = await h.app.inject({ method: 'POST', url: '/api/v1/storage/volumes', headers: { authorization: `Bearer ${token}` }, payload: { uuid: 'vol-1', label: 'LectureDisk' } });
    expect(response.statusCode).toBe(201);
    expect(zRegisterStorageVolumeResponse.safeParse(response.json()).success).toBe(true);
    expect(h.helperTransport.ledger.map(({ verb, args }) => ({ verb, args }))).toEqual([{ verb: 'volume.mount', args: { uuid: 'vol-1' } }]);
    const duplicate = await h.app.inject({ method: 'POST', url: '/api/v1/storage/volumes', headers: { authorization: `Bearer ${token}` }, payload: { uuid: 'vol-1' } });
    expect(duplicate.statusCode).toBe(409);
    expect(h.helperTransport.ledger).toHaveLength(1);
  });

  it('rejects lecturers and preserves the helper ledger', async () => {
    const h = await harness(); const token = await h.token('volume-lecturer');
    const response = await h.app.inject({ method: 'POST', url: '/api/v1/storage/volumes', headers: { authorization: `Bearer ${token}` }, payload: { uuid: 'vol-1' } });
    expect(response.statusCode).toBe(403);
    const volumeId = h.ids.next(NOW);
    h.app.db.insert(storageVolumes).values({ id: volumeId, uuid: 'vol-1', devicePath: '/dev/sdb1', mountPath: '/media/eduscope/vol-1', label: 'LectureDisk', filesystem: 'ext4', capacityBytes: 1000, freeBytes: 900, smartStatus: 'unknown', role: 'recordings', state: 'mounted', registeredAt: NOW.toISOString(), registeredBy: h.adminId }).run();
    const format = await h.app.inject({ method: 'POST', url: `/api/v1/storage/volumes/${volumeId}/format`, headers: { authorization: `Bearer ${token}` }, payload: { confirmText: 'LectureDisk' } });
    expect(format.statusCode).toBe(403);
    expect(h.helperTransport.ledger).toEqual([]);
  });

  it('guards confirmation and recording state, then formats with the exact three calls', async () => {
    const h = await harness(); const token = await h.token('volume-admin');
    const volumeId = h.ids.next(NOW);
    h.app.db.insert(storageVolumes).values({ id: volumeId, uuid: 'vol-1', devicePath: '/dev/sdb1', mountPath: '/media/eduscope/vol-1', label: 'LectureDisk', filesystem: 'xfs', capacityBytes: 1000, freeBytes: 900, smartStatus: 'unknown', role: 'recordings', state: 'mounted', registeredAt: NOW.toISOString(), registeredBy: h.adminId }).run();
    const wrong = await h.app.inject({ method: 'POST', url: `/api/v1/storage/volumes/${volumeId}/format`, headers: { authorization: `Bearer ${token}` }, payload: { confirmText: 'wrong' } });
    expect(wrong.statusCode).toBe(422);
    h.app.db.insert(lectureSessions).values({ id: h.ids.next(NOW), title: 'Active', hallCode: 'H', hallDisplayName: 'Hall', deviceId: 'device', ownerUserId: h.lecturerId, startedByActor: 'user', state: 'recording', startedAt: NOW.toISOString(), pauseCount: 0, channelActivations: [], sourceSnapshot: {}, aiEnabledAtStart: false }).run();
    const active = await h.app.inject({ method: 'POST', url: `/api/v1/storage/volumes/${volumeId}/format`, headers: { authorization: `Bearer ${token}` }, payload: { confirmText: 'LectureDisk' } });
    expect(active.statusCode).toBe(409);
    h.app.db.update(lectureSessions).set({ state: 'completed', endedAt: NOW.toISOString() }).run();
    const response = await h.app.inject({ method: 'POST', url: `/api/v1/storage/volumes/${volumeId}/format`, headers: { authorization: `Bearer ${token}` }, payload: { confirmText: 'LectureDisk' } });
    expect(response.statusCode).toBe(202);
    expect(zFormatStorageVolumeResponse.safeParse(response.json()).success).toBe(true);
    expect(h.helperTransport.ledger.map(({ verb, args }) => ({ verb, args }))).toEqual([
      { verb: 'volume.unmount', args: { uuid: 'vol-1' } },
      { verb: 'volume.format', args: { devNode: '/dev/sdb1', fs: 'ext4', label: 'LectureDisk' } },
      { verb: 'volume.mount', args: { uuid: 'vol-1' } },
    ]);
    expect(h.app.db.select().from(storageVolumes).where(eq(storageVolumes.id, volumeId)).get()).toMatchObject({ uuid: 'vol-1', filesystem: 'ext4', state: 'mounted' });
  });

  it('rejects non-current devnodes and preserves registration on helper failure', async () => {
    const h = await harness(); const token = await h.token('volume-admin'); const volumeId = h.ids.next(NOW);
    h.app.db.insert(storageVolumes).values({ id: volumeId, uuid: 'vol-1', devicePath: '/dev/sdb1', mountPath: '/media/eduscope/vol-1', label: null, filesystem: 'xfs', capacityBytes: 1000, freeBytes: 900, smartStatus: 'good', role: 'recordings', state: 'mounted', registeredAt: NOW.toISOString(), registeredBy: h.adminId }).run();
    h.resolver.current = null;
    const stale = await h.app.inject({ method: 'POST', url: `/api/v1/storage/volumes/${volumeId}/format`, headers: { authorization: `Bearer ${token}` }, payload: { confirmText: 'vol-1' } });
    expect(stale.statusCode).toBe(422); expect(h.helperTransport.ledger).toEqual([]);
    h.resolver.current = { uuid: 'vol-1', devNode: '/dev/sdb1', mountPath: '/media/eduscope/vol-1', label: null, filesystem: 'xfs', capacityBytes: 1000, freeBytes: 900 };
    h.helperTransport.failureVerb = 'volume.format';
    const failed = await h.app.inject({ method: 'POST', url: `/api/v1/storage/volumes/${volumeId}/format`, headers: { authorization: `Bearer ${token}` }, payload: { confirmText: 'vol-1' } });
    expect(failed.statusCode).toBe(422);
    expect(h.app.db.select().from(storageVolumes).where(eq(storageVolumes.id, volumeId)).get()).toMatchObject({ filesystem: 'xfs', state: 'mounted' });
  });
});

it.skipIf(process.platform === 'win32')('AF_UNIX filesystem socket coverage runs on Linux', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'helper-framing-')); dirs.push(dir);
  const socketPath = join(dir, 'helper.sock');
  const fixture = await startFakeHelperServer(socketPath);
  const client = new HelperClient({ transport: new UnixHelperTransport(socketPath), clock: new FakeClock(NOW) });
  await client.request('volume.mount', { uuid: 'vol-1' }, 'req-posix');
  expect(fixture.ledger).toEqual([{ verb: 'volume.mount', args: { uuid: 'vol-1' }, requestId: 'req-posix' }]);
  await new Promise<void>((resolve) => fixture.server.close(() => resolve()));
});
