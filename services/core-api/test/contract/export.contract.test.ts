import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zCancelExportResponse, zCreateExportResponse, zGetExportResponse, zListExportTargetsResponse, zProblem } from '@eduscope/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { lectureSessions, recordingFiles, recordings, users } from '../../src/db/schema.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { FakeBlockDeviceMonitor, type FakeBlockDevice } from '../fakes/block-devices.js';
import { FakeClock } from '../fakes/clock.js';
import { FakePipelineManager } from '../fakes/pipeline-manager.js';

const NOW = new Date('2026-07-08T00:00:00.000Z');
interface Harness { app: FastifyInstance; dir: string; pm: FakePipelineManager; token: string; recordingId: string; volume: FakeBlockDevice; monitor: FakeBlockDeviceMonitor; }

async function setup(): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'core-api-export-contract-'));
  const recordingsRoot = join(dir, 'recordings');
  const volume: FakeBlockDevice = { devicePath: '/dev/sdb1', mountPath: join(dir, 'usb'), label: 'USB', capacityBytes: 100_000, freeBytes: 90_000, usage: 'removable' };
  mkdirSync(volume.mountPath, { recursive: true });
  const monitor = new FakeBlockDeviceMonitor([volume]);
  const pm = new FakePipelineManager({ bearerToken: 'export-contract-bearer' });
  const config = loadConfig({ NODE_ENV: 'test', CORE_API_DB_PATH: join(dir, 'core.db'), CORE_API_JWT_SECRET: 'export-contract-secret', CORE_API_RECORDINGS_ROOT: recordingsRoot, CORE_API_PM_BASE_URL: await pm.listen(), CORE_API_INTERNAL_BEARER: 'export-contract-bearer' });
  const ids = new UlidGenerator();
  const app = await buildApp({ config, clock: new FakeClock(NOW), ids, blockDevices: monitor } as never);
  await app.lifecycle.start();
  const userId = ids.next(NOW);
  await app.db.insert(users).values({ id: userId, username: 'export-contract', displayName: 'Export Contract', role: 'lecturer', source: 'local', passwordHash: await hashPassword('Password1'), mustResetPassword: false, disabled: false, createdAt: NOW.toISOString() }).run();
  const sessionId = ids.next(NOW);
  const recordingId = ids.next(NOW);
  app.db.insert(lectureSessions).values({ id: sessionId, title: 'Contract', hallCode: 'HALL-1', hallDisplayName: 'Hall 1', deviceId: 'device-contract', ownerUserId: userId, startedByActor: 'user', state: 'completed', startedAt: NOW.toISOString(), endedAt: NOW.toISOString(), recordedDurationMs: 1000, pauseCount: 0, channelActivations: [], sourceSnapshot: {}, aiEnabledAtStart: false }).run();
  app.db.insert(recordings).values({ id: recordingId, sessionId, ownerUserId: userId, state: 'ready', layoutPresetId: 'pc-only', segmentCount: 1, mergeState: 'done', retentionDeleteAfter: NOW.toISOString(), playbackAuthRequired: true }).run();
  const filePath = join(recordingsRoot, sessionId, 'main.mp4');
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, Buffer.alloc(1_000));
  app.db.insert(recordingFiles).values({ id: ids.next(NOW), recordingId, segmentId: null, kind: 'derived', streamKey: 'main', path: filePath, container: 'mp4', sizeBytes: 1_000, durationMs: 1000, state: 'finalized', hasAudio: true, isUploadable: true }).run();
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'export-contract', password: 'Password1', client: 'panel' } });
  return { app, dir, pm, recordingId, volume, monitor, token: (login.json() as { tokens: { accessToken: string } }).tokens.accessToken };
}

describe('B-16 export operation contracts', () => {
  let h: Harness;
  beforeEach(async () => { h = await setup(); });
  afterEach(async () => { await h.app.close(); await h.pm.close(); rmSync(h.dir, { recursive: true, force: true }); });
  const headers = () => ({ authorization: `Bearer ${h.token}` });

  it('listExportTargets 200', async () => {
    const response = await h.app.inject({ method: 'GET', url: '/api/v1/exports/targets', headers: headers() });
    expect(response.statusCode).toBe(200);
    zListExportTargetsResponse.parse(response.json());
  });
  it('createExport 202 and getExport 200', async () => {
    const created = await h.app.inject({ method: 'POST', url: '/api/v1/exports', headers: headers(), payload: { recordingIds: [h.recordingId], targetDevicePath: h.volume.devicePath } });
    expect(created.statusCode).toBe(202);
    const job = zCreateExportResponse.parse(created.json());
    const got = await h.app.inject({ method: 'GET', url: `/api/v1/exports/${job.id}`, headers: headers() });
    expect(got.statusCode).toBe(200);
    zGetExportResponse.parse(got.json());
  });
  it('createExport 422', async () => {
    h.monitor.setVolumes([{ ...h.volume, freeBytes: 0 }]);
    const response = await h.app.inject({ method: 'POST', url: '/api/v1/exports', headers: headers(), payload: { recordingIds: [h.recordingId], targetDevicePath: h.volume.devicePath } });
    expect(response.statusCode).toBe(422);
    expect(zProblem.parse(response.json()).code).toBe('export.insufficient-space');
  });
  it('getExport 404', async () => {
    const response = await h.app.inject({ method: 'GET', url: '/api/v1/exports/01K00000000000000000000000', headers: headers() });
    expect(response.statusCode).toBe(404);
    zProblem.parse(response.json());
  });
  it('cancelExport 202 then 409', async () => {
    const created = await h.app.inject({ method: 'POST', url: '/api/v1/exports', headers: headers(), payload: { recordingIds: [h.recordingId], targetDevicePath: h.volume.devicePath } });
    const job = zCreateExportResponse.parse(created.json());
    const cancelled = await h.app.inject({ method: 'POST', url: `/api/v1/exports/${job.id}/cancel`, headers: headers() });
    expect(cancelled.statusCode).toBe(202);
    zCancelExportResponse.parse(cancelled.json());
    const repeated = await h.app.inject({ method: 'POST', url: `/api/v1/exports/${job.id}/cancel`, headers: headers() });
    expect(repeated.statusCode).toBe(409);
    zProblem.parse(repeated.json());
  });
});
