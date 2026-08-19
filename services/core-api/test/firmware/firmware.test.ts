import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { FastifyInstance } from 'fastify';
import type { FirmwareUpdate } from '@eduscope/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { lectureSessions, users } from '../../src/db/schema.js';
import type { HelperTransport } from '../../src/lib/helper-client.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { FakeClock } from '../fakes/clock.js';
import { FakePipelineManager } from '../fakes/pipeline-manager.js';

const NOW = new Date('2026-08-19T00:00:00.000Z');
const BEARER = 'firmware-test-pm-bearer';

interface CheckDetail {
  availableVersion: string | null;
  artifactDigest: string | null;
  signatureVerified: boolean;
}

interface ApplyDetail {
  outcome: 'done' | 'bad-signature' | 'boot-failed';
  rollbackVersion?: string | null;
}

class FirmwareHelperTransport implements HelperTransport {
  readonly ledger: Array<{ verb: string; args: Record<string, unknown> }> = [];
  checkDetail: CheckDetail = { availableVersion: null, artifactDigest: null, signatureVerified: false };
  applyDetail: ApplyDetail = { outcome: 'done' };
  failVerb: string | null = null;
  hang = false;

  async request(line: string, signal: AbortSignal): Promise<string> {
    if (this.hang) {
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    }
    const req = JSON.parse(line.trim()) as { verb: string; args: Record<string, unknown> };
    this.ledger.push({ verb: req.verb, args: req.args });
    if (this.failVerb === req.verb) return JSON.stringify({ ok: false, detail: `${req.verb} failed` });
    if (req.verb === 'firmware.check') return JSON.stringify({ ok: true, detail: JSON.stringify(this.checkDetail) });
    if (req.verb === 'firmware.apply') return JSON.stringify({ ok: true, detail: JSON.stringify(this.applyDetail) });
    return JSON.stringify({ ok: true, detail: 'ok' });
  }
}

interface TestApp {
  app: FastifyInstance;
  dir: string;
  pm: FakePipelineManager;
  ids: UlidGenerator;
  transport: FirmwareHelperTransport;
  lecturerId: string;
  lecturerToken: string;
  adminToken: string;
}

async function loginAs(app: FastifyInstance, username: string, password: string): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password, client: 'panel' } });
  return (response.json() as { tokens: { accessToken: string } }).tokens.accessToken;
}

async function startTestApp(): Promise<TestApp> {
  const dir = mkdtempSync(join(tmpdir(), 'core-api-firmware-'));
  const pm = new FakePipelineManager({ bearerToken: BEARER });
  const pmBaseUrl = await pm.listen();

  const provisioningPath = join(dir, 'provisioning.json');
  writeFileSync(provisioningPath, JSON.stringify({ deviceId: 'device-1', hallCode: 'LAC001', hallDisplayName: 'Lecture Hall 1', titlePattern: '{hall} – {date} {time}' }));

  const config = loadConfig({
    NODE_ENV: 'test',
    CORE_API_DB_PATH: join(dir, 'core.db'),
    CORE_API_JWT_SECRET: 'firmware-test-secret',
    CORE_API_PROVISIONING_PATH: provisioningPath,
    CORE_API_RECORDINGS_ROOT: join(dir, 'recordings'),
    CORE_API_PM_BASE_URL: pmBaseUrl,
    CORE_API_INTERNAL_BEARER: BEARER,
  });

  const ids = new UlidGenerator();
  const transport = new FirmwareHelperTransport();
  const app = await buildApp({ config, clock: new FakeClock(NOW), ids, helperTransport: transport });
  await app.lifecycle.start();

  const lecturerId = ids.next(NOW);
  await app.db.insert(users).values([
    { id: lecturerId, username: 'lecturer1', displayName: 'Lecturer', role: 'lecturer', source: 'local', passwordHash: await hashPassword('Password1'), mustResetPassword: false, disabled: false, createdAt: NOW.toISOString() },
    { id: ids.next(NOW), username: 'admin1', displayName: 'Admin', role: 'admin', source: 'local', passwordHash: await hashPassword('Password1'), mustResetPassword: false, disabled: false, createdAt: NOW.toISOString() },
  ]).run();

  const lecturerToken = await loginAs(app, 'lecturer1', 'Password1');
  const adminToken = await loginAs(app, 'admin1', 'Password1');

  return { app, dir, pm, ids, transport, lecturerId, lecturerToken, adminToken };
}

async function stopTestApp(testApp: TestApp): Promise<void> {
  await testApp.app.close();
  await testApp.pm.close();
  rmSync(testApp.dir, { recursive: true, force: true });
}

async function getState(testApp: TestApp): Promise<FirmwareUpdate> {
  const response = await testApp.app.inject({ method: 'GET', url: '/api/v1/firmware', headers: { authorization: `Bearer ${testApp.adminToken}` } });
  return response.json() as FirmwareUpdate;
}

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: condition not met in time');
    await delay(5);
  }
}

function insertActiveSession(testApp: TestApp, state: 'starting' | 'recording' | 'paused' | 'stopping' | 'finalizing'): void {
  testApp.app.db
    .insert(lectureSessions)
    .values({
      id: testApp.ids.next(NOW),
      title: 'Active',
      hallCode: 'LAC001',
      hallDisplayName: 'Lecture Hall 1',
      deviceId: 'device-1',
      ownerUserId: testApp.lecturerId,
      startedByActor: 'user',
      state,
      startedAt: NOW.toISOString(),
      pauseCount: 0,
      channelActivations: [],
      sourceSnapshot: {},
      aiEnabledAtStart: false,
    })
    .run();
}

describe('firmware lifecycle (openapi.yaml tag: firmware — getFirmwareState, checkFirmware, applyFirmware)', () => {
  let testApp: TestApp;
  afterEach(async () => stopTestApp(testApp));

  it('getFirmwareState: bootstraps an idle singleton row, admin-only', async () => {
    testApp = await startTestApp();
    const lecturerResponse = await testApp.app.inject({ method: 'GET', url: '/api/v1/firmware', headers: { authorization: `Bearer ${testApp.lecturerToken}` } });
    expect(lecturerResponse.statusCode).toBe(403);

    const state = await getState(testApp);
    expect(state.state).toBe('idle');
    expect(state.availableVersion).toBeNull();
    expect(state.currentVersion).toBeTruthy();
  });

  it('checkFirmware: idle→checking→idle-with-available on an update, admin-only, idempotent while at rest', async () => {
    testApp = await startTestApp();
    testApp.transport.checkDetail = { availableVersion: '0.2.0', artifactDigest: 'sha256:deadbeef', signatureVerified: true };

    const lecturerResponse = await testApp.app.inject({ method: 'POST', url: '/api/v1/firmware/check', headers: { authorization: `Bearer ${testApp.lecturerToken}` } });
    expect(lecturerResponse.statusCode).toBe(403);

    const response = await testApp.app.inject({ method: 'POST', url: '/api/v1/firmware/check', headers: { authorization: `Bearer ${testApp.adminToken}` } });
    expect(response.statusCode).toBe(202);

    await waitFor(async () => (await getState(testApp)).state === 'idle' && (await getState(testApp)).availableVersion === '0.2.0');
    const state = await getState(testApp);
    expect(state.availableVersion).toBe('0.2.0');
    expect(state.signatureVerified).toBe(true);

    // Idempotent: calling again while at rest just re-checks, not a conflict.
    const second = await testApp.app.inject({ method: 'POST', url: '/api/v1/firmware/check', headers: { authorization: `Bearer ${testApp.adminToken}` } });
    expect(second.statusCode).toBe(202);
  });

  it('checkFirmware: no update available leaves the row idle with a null availableVersion', async () => {
    testApp = await startTestApp();
    testApp.transport.checkDetail = { availableVersion: null, artifactDigest: null, signatureVerified: false };

    await testApp.app.inject({ method: 'POST', url: '/api/v1/firmware/check', headers: { authorization: `Bearer ${testApp.adminToken}` } });
    await waitFor(() => testApp.transport.ledger.some((entry) => entry.verb === 'firmware.check'));
    await delay(20);

    const state = await getState(testApp);
    expect(state.state).toBe('idle');
    expect(state.availableVersion).toBeNull();
  });

  it('checkFirmware: a helper failure lands the row in failed', async () => {
    testApp = await startTestApp();
    testApp.transport.failVerb = 'firmware.check';

    await testApp.app.inject({ method: 'POST', url: '/api/v1/firmware/check', headers: { authorization: `Bearer ${testApp.adminToken}` } });
    await waitFor(async () => (await getState(testApp)).state === 'failed');
    const state = await getState(testApp);
    expect(state.lastError).toBeTruthy();
  });

  it('applyFirmware: refused while a recording is active — the helper never runs', async () => {
    testApp = await startTestApp();
    testApp.transport.checkDetail = { availableVersion: '0.2.0', artifactDigest: 'sha256:deadbeef', signatureVerified: true };
    await testApp.app.inject({ method: 'POST', url: '/api/v1/firmware/check', headers: { authorization: `Bearer ${testApp.adminToken}` } });
    await waitFor(async () => (await getState(testApp)).availableVersion === '0.2.0');

    insertActiveSession(testApp, 'recording');
    testApp.transport.ledger.length = 0;

    const response = await testApp.app.inject({ method: 'POST', url: '/api/v1/firmware/apply', headers: { authorization: `Bearer ${testApp.adminToken}` } });
    expect(response.statusCode).toBe(409);
    expect(testApp.transport.ledger.some((entry) => entry.verb === 'firmware.apply')).toBe(false);
  });

  it('applyFirmware: refused with nothing verified available', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({ method: 'POST', url: '/api/v1/firmware/apply', headers: { authorization: `Bearer ${testApp.adminToken}` } });
    expect(response.statusCode).toBe(409);
  });

  it('applyFirmware: apply→done snapshots the DB before calling the helper and adopts the new version', async () => {
    testApp = await startTestApp();
    testApp.transport.checkDetail = { availableVersion: '0.2.0', artifactDigest: 'sha256:deadbeef', signatureVerified: true };
    await testApp.app.inject({ method: 'POST', url: '/api/v1/firmware/check', headers: { authorization: `Bearer ${testApp.adminToken}` } });
    await waitFor(async () => (await getState(testApp)).availableVersion === '0.2.0');

    testApp.transport.applyDetail = { outcome: 'done' };
    const response = await testApp.app.inject({ method: 'POST', url: '/api/v1/firmware/apply', headers: { authorization: `Bearer ${testApp.adminToken}` } });
    expect(response.statusCode).toBe(202);

    await waitFor(async () => (await getState(testApp)).state === 'done');
    const state = await getState(testApp);
    expect(state.currentVersion).toBe('0.2.0');
    expect(state.availableVersion).toBeNull();
    expect(state.finishedAt).toBeTruthy();
    expect(testApp.transport.ledger.some((entry) => entry.verb === 'firmware.apply')).toBe(true);
  });

  it('applyFirmware: bad-signature→failed', async () => {
    testApp = await startTestApp();
    testApp.transport.checkDetail = { availableVersion: '0.2.0', artifactDigest: 'sha256:deadbeef', signatureVerified: true };
    await testApp.app.inject({ method: 'POST', url: '/api/v1/firmware/check', headers: { authorization: `Bearer ${testApp.adminToken}` } });
    await waitFor(async () => (await getState(testApp)).availableVersion === '0.2.0');

    const before = await getState(testApp);
    testApp.transport.applyDetail = { outcome: 'bad-signature' };
    await testApp.app.inject({ method: 'POST', url: '/api/v1/firmware/apply', headers: { authorization: `Bearer ${testApp.adminToken}` } });

    await waitFor(async () => (await getState(testApp)).state === 'failed');
    const state = await getState(testApp);
    expect(state.lastError).toBe('signature verification failed');
    expect(state.currentVersion).toBe(before.currentVersion);
  });

  it('applyFirmware: failed boot→rolled-back, current version untouched', async () => {
    testApp = await startTestApp();
    testApp.transport.checkDetail = { availableVersion: '0.2.0', artifactDigest: 'sha256:deadbeef', signatureVerified: true };
    await testApp.app.inject({ method: 'POST', url: '/api/v1/firmware/check', headers: { authorization: `Bearer ${testApp.adminToken}` } });
    await waitFor(async () => (await getState(testApp)).availableVersion === '0.2.0');

    const before = await getState(testApp);
    testApp.transport.applyDetail = { outcome: 'boot-failed', rollbackVersion: before.currentVersion };
    await testApp.app.inject({ method: 'POST', url: '/api/v1/firmware/apply', headers: { authorization: `Bearer ${testApp.adminToken}` } });

    await waitFor(async () => (await getState(testApp)).state === 'rolled-back');
    const state = await getState(testApp);
    expect(state.rollbackVersion).toBe(before.currentVersion);
    expect(state.currentVersion).toBe(before.currentVersion);
  });
});
