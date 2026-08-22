import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { ExportJob, ExportJobPayload, UsbVolumesPayload } from '@eduscope/shared';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { openDatabase } from '../../src/db/client.js';
import { exportJobs, lectureSessions, recordingFiles, recordings, users } from '../../src/db/schema.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { FakeBlockDeviceMonitor, type FakeBlockDevice } from '../fakes/block-devices.js';
import { FakeClock } from '../fakes/clock.js';
import { FakePipelineManager } from '../fakes/pipeline-manager.js';

const NOW = new Date('2026-07-07T00:00:00.000Z');
const PM_BEARER = 'export-test-pm-bearer';
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

class ControlledSources {
  pause = false;
  open(path: string, signal: AbortSignal): Readable {
    const data = readFileSync(path);
    const pause = this.pause;
    return Readable.from((async function* () {
      for (let offset = 0; offset < data.length; offset += 32_000) {
        if (signal.aborted) throw signal.reason;
        yield data.subarray(offset, Math.min(offset + 32_000, data.length));
        if (pause && offset === 32_000) {
          await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
          if (signal.aborted) throw signal.reason;
        }
      }
    })());
  }
}

interface Harness {
  app: FastifyInstance;
  dir: string;
  pm: FakePipelineManager;
  clock: FakeClock;
  monitor: FakeBlockDeviceMonitor;
  sources: ControlledSources;
  tokenA: string;
  tokenB: string;
  sidA: string;
  sidB: string;
  recordingIds: string[];
  sourcePaths: string[];
  usbA: FakeBlockDevice;
  usbB: FakeBlockDevice;
}

const running: Harness[] = [];

async function eventually<T>(read: () => T | undefined, timeoutMs = 3_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('timed out waiting for export lifecycle');
}

function partials(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.partial'))
    .map((entry) => join(entry.parentPath, entry.name));
}

async function login(app: FastifyInstance, username: string): Promise<{ token: string; sid: string }> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password: 'Password1', client: 'panel' } });
  const token = (response.json() as { tokens: { accessToken: string } }).tokens.accessToken;
  return { token, sid: app.jwt.verify<{ sid: string }>(token).sid };
}

async function makeHarness(): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'core-api-export-'));
  const recordingsRoot = join(dir, 'recordings');
  const usbA: FakeBlockDevice = { devicePath: '/dev/sdb1', mountPath: join(dir, 'usb-a'), label: 'USB A', capacityBytes: 2_000_000, freeBytes: 1_500_000, usage: 'removable' };
  const usbB: FakeBlockDevice = { devicePath: '/dev/sdc1', mountPath: join(dir, 'usb-b'), label: 'USB B', capacityBytes: 4_000_000, freeBytes: 3_500_000, usage: 'removable' };
  mkdirSync(usbA.mountPath, { recursive: true });
  mkdirSync(usbB.mountPath, { recursive: true });
  const monitor = new FakeBlockDeviceMonitor([
    usbA,
    usbB,
    { devicePath: '/dev/nvme0n1p2', mountPath: '/', label: 'System', capacityBytes: 1, freeBytes: 1, usage: 'system' },
    { devicePath: '/dev/sda1', mountPath: recordingsRoot, label: 'Recordings', capacityBytes: 1, freeBytes: 1, usage: 'recordings' },
  ]);
  const sources = new ControlledSources();
  const pm = new FakePipelineManager({ bearerToken: PM_BEARER });
  const config = loadConfig({ NODE_ENV: 'test', CORE_API_DB_PATH: join(dir, 'core.db'), CORE_API_JWT_SECRET: 'export-test-secret', CORE_API_RECORDINGS_ROOT: recordingsRoot, CORE_API_PM_BASE_URL: await pm.listen(), CORE_API_INTERNAL_BEARER: PM_BEARER });
  const ids = new UlidGenerator();
  const clock = new FakeClock(NOW);
  const app = await buildApp({ config, clock, ids, blockDevices: monitor, exportSourceStream: (path: string, signal: AbortSignal) => sources.open(path, signal) } as never);
  await app.lifecycle.start();
  const userA = ids.next(NOW);
  const userB = ids.next(NOW);
  await app.db.insert(users).values([
    { id: userA, username: 'export-a', displayName: 'Export A', role: 'lecturer', source: 'local', passwordHash: await hashPassword('Password1'), mustResetPassword: false, disabled: false, createdAt: NOW.toISOString() },
    { id: userB, username: 'export-b', displayName: 'Export B', role: 'lecturer', source: 'local', passwordHash: await hashPassword('Password1'), mustResetPassword: false, disabled: false, createdAt: NOW.toISOString() },
  ]).run();
  const recordingIds: string[] = [];
  const sourcePaths: string[] = [];
  for (let index = 0; index < 2; index += 1) {
    const sessionId = ids.next(NOW);
    const recordingId = ids.next(NOW);
    recordingIds.push(recordingId);
    app.db.insert(lectureSessions).values({ id: sessionId, title: `Lecture ${index}`, hallCode: 'HALL-1', hallDisplayName: 'Hall 1', deviceId: `device-${index}`, ownerUserId: userA, startedByActor: 'user', state: 'completed', startedAt: NOW.toISOString(), endedAt: NOW.toISOString(), recordedDurationMs: 1000, pauseCount: 0, channelActivations: [], sourceSnapshot: {}, aiEnabledAtStart: false }).run();
    app.db.insert(recordings).values({ id: recordingId, sessionId, ownerUserId: userA, state: 'ready', layoutPresetId: 'pc-only', segmentCount: 1, mergeState: 'done', retentionDeleteAfter: NOW.toISOString(), playbackAuthRequired: true }).run();
    for (const key of ['main', 'slides']) {
      const filePath = join(recordingsRoot, sessionId, `${key}.mp4`);
      mkdirSync(join(filePath, '..'), { recursive: true });
      writeFileSync(filePath, Buffer.alloc(160_000, index + (key === 'main' ? 1 : 4)));
      sourcePaths.push(filePath);
      app.db.insert(recordingFiles).values({ id: ids.next(NOW), recordingId, segmentId: null, kind: 'derived', streamKey: key, path: filePath, container: 'mp4', sizeBytes: 160_000, durationMs: 1000, state: 'finalized', hasAudio: true, isUploadable: true }).run();
    }
  }
  const a = await login(app, 'export-a');
  const b = await login(app, 'export-b');
  const result = { app, dir, pm, clock, monitor, sources, tokenA: a.token, tokenB: b.token, sidA: a.sid, sidB: b.sid, recordingIds, sourcePaths, usbA, usbB };
  running.push(result);
  return result;
}

afterEach(async () => {
  for (const h of running.splice(0)) {
    await h.app.close();
    await h.pm.close();
    rmSync(h.dir, { recursive: true, force: true });
  }
});

describe('USB export lifecycle (LP-10/LP-11, KEEP B-32)', () => {
  it('excludes system/recordings volumes and requires the user-selected target', async () => {
    const h = await makeHarness();
    const listed = await h.app.inject({ method: 'GET', url: '/api/v1/exports/targets', headers: auth(h.tokenA) });
    expect(listed.statusCode).toBe(200);
    expect((listed.json() as { items: FakeBlockDevice[] }).items.map((item) => item.devicePath)).toEqual(['/dev/sdb1', '/dev/sdc1']);
    const omitted = await h.app.inject({ method: 'POST', url: '/api/v1/exports', headers: auth(h.tokenA), payload: { recordingIds: h.recordingIds } });
    expect(omitted.statusCode).toBe(422);
  });

  it('expands all requested recording files and rechecks free space at create time', async () => {
    const h = await makeHarness();
    await h.app.inject({ method: 'GET', url: '/api/v1/exports/targets', headers: auth(h.tokenA) });
    h.monitor.setVolumes([{ ...h.usbA, freeBytes: 100 }]);
    const response = await h.app.inject({ method: 'POST', url: '/api/v1/exports', headers: auth(h.tokenA), payload: { recordingIds: h.recordingIds, targetDevicePath: h.usbA.devicePath } });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ code: 'export.insufficient-space' });
    expect(h.app.db.select().from(exportJobs).all()).toHaveLength(0);
  });

  it('copies one file at a time, reports real bytes at >=5% intervals, fsyncs, and completes', async () => {
    const h = await makeHarness();
    const events: ExportJobPayload[] = [];
    (h.app.bus as never as { subscribe(type: string, listener: (payload: ExportJobPayload) => void): () => void }).subscribe('export.job', (payload) => events.push(payload));
    const response = await h.app.inject({ method: 'POST', url: '/api/v1/exports', headers: auth(h.tokenA), payload: { recordingIds: h.recordingIds, targetDevicePath: h.usbB.devicePath } });
    expect(response.statusCode).toBe(202);
    const job = response.json() as ExportJob;
    expect(job.bytesTotal).toBe(640_000);
    const completed = await eventually(() => {
      const row = h.app.db.select().from(exportJobs).where(eq(exportJobs.id, job.id)).get();
      return row?.state === 'completed' ? row : undefined;
    });
    expect(completed.bytesCopied).toBe(640_000);
    expect(events[0]).toMatchObject({ jobId: job.id, state: 'queued', bytesCopied: 0 });
    expect(events.at(-1)).toMatchObject({ jobId: job.id, state: 'completed', bytesCopied: 640_000 });
    const progress = events.filter((event) => event.state === 'copying' && event.bytesCopied > 0).map((event) => event.bytesCopied);
    for (let index = 1; index < progress.length; index += 1) expect(progress[index]! - progress[index - 1]!).toBeGreaterThanOrEqual(32_000);
    for (const source of h.sourcePaths) expect(existsSync(source)).toBe(true);
    expect(readdirSync(join(h.usbB.mountPath, 'EduScope'), { recursive: true }).filter((name) => String(name).endsWith('.mp4'))).toHaveLength(4);
  });

  it.each(['cancel', 'pull'] as const)('%s abort removes only partial targets and never source files', async (mode) => {
    const h = await makeHarness();
    h.sources.pause = true;
    const response = await h.app.inject({ method: 'POST', url: '/api/v1/exports', headers: auth(h.tokenA), payload: { recordingIds: [h.recordingIds[0]!], targetDevicePath: h.usbA.devicePath } });
    const job = response.json() as ExportJob;
    await eventually(() => partials(h.usbA.mountPath).length > 0 ? true : undefined);
    if (mode === 'cancel') {
      const cancelled = await h.app.inject({ method: 'POST', url: `/api/v1/exports/${job.id}/cancel`, headers: auth(h.tokenA) });
      expect(cancelled.statusCode).toBe(202);
    } else {
      h.monitor.setVolumes([h.usbB]);
    }
    const expected = mode === 'cancel' ? 'cancelled' : 'failed';
    const terminal = await eventually(() => {
      const row = h.app.db.select().from(exportJobs).where(eq(exportJobs.id, job.id)).get();
      return row?.state === expected ? row : undefined;
    });
    if (mode === 'pull') expect(terminal.error).toMatch(/removed/i);
    expect(partials(h.usbA.mountPath)).toEqual([]);
    for (const source of h.sourcePaths) expect(existsSync(source)).toBe(true);
  });

  it('scopes job/volume streams to one AuthSession with a REST-refreshed 120-second TTL', async () => {
    const h = await makeHarness();
    const registry = (h.app as never as { scopedSubscriptions: { allows(sid: string, stream: string, scope?: string): boolean } }).scopedSubscriptions;
    await h.app.inject({ method: 'GET', url: '/api/v1/exports/targets', headers: auth(h.tokenA) });
    expect(registry.allows(h.sidA, 'usb.volumes')).toBe(true);
    expect(registry.allows(h.sidB, 'usb.volumes')).toBe(false);
    h.clock.advance(119_000);
    await h.app.inject({ method: 'GET', url: '/api/v1/exports/targets', headers: auth(h.tokenA) });
    h.clock.advance(119_000);
    expect(registry.allows(h.sidA, 'usb.volumes')).toBe(true);
    h.clock.advance(2_000);
    expect(registry.allows(h.sidA, 'usb.volumes')).toBe(false);
    const created = await h.app.inject({ method: 'POST', url: '/api/v1/exports', headers: auth(h.tokenA), payload: { recordingIds: [h.recordingIds[0]!], targetDevicePath: h.usbB.devicePath } });
    const job = created.json() as ExportJob;
    expect(registry.allows(h.sidA, 'export.job', job.id)).toBe(true);
    expect(registry.allows(h.sidB, 'export.job', job.id)).toBe(false);
  });

  it('publishes a filtered hotplug snapshot', async () => {
    const h = await makeHarness();
    const events: UsbVolumesPayload[] = [];
    (h.app.bus as never as { subscribe(type: string, listener: (payload: UsbVolumesPayload) => void): () => void }).subscribe('usb.volumes', (payload) => events.push(payload));
    h.monitor.setVolumes([h.usbB, { devicePath: '/dev/root', mountPath: '/', label: null, capacityBytes: 1, freeBytes: 1, usage: 'system' }]);
    expect(events.at(-1)?.volumes.map((volume) => volume.devicePath)).toEqual([h.usbB.devicePath]);
  });

  it('graceful stop aborts active copy, removes its partial, and persists an honest failure', async () => {
    const h = await makeHarness();
    h.sources.pause = true;
    const created = await h.app.inject({ method: 'POST', url: '/api/v1/exports', headers: auth(h.tokenA), payload: { recordingIds: [h.recordingIds[0]!], targetDevicePath: h.usbA.devicePath } });
    const job = created.json() as ExportJob;
    await eventually(() => partials(h.usbA.mountPath).length ? true : undefined);
    await h.app.close();
    const reopened = openDatabase(join(h.dir, 'core.db'));
    const row = reopened.db.select().from(exportJobs).where(eq(exportJobs.id, job.id)).get();
    reopened.close();
    expect(row?.state).toBe('failed');
    expect(row?.error).toMatch(/shutdown/i);
    expect(partials(h.usbA.mountPath)).toEqual([]);
    running.splice(running.indexOf(h), 1);
    await h.pm.close();
    rmSync(h.dir, { recursive: true, force: true });
  });
});
