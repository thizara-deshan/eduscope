import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { FastifyInstance } from 'fastify';
import type { AudioControlPayload } from '@eduscope/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { storageVolumes, users } from '../../src/db/schema.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { FakeClock } from '../fakes/clock.js';
import { FakePipelineManager } from '../fakes/pipeline-manager.js';

const NOW = new Date('2026-06-05T00:00:00.000Z');
const BEARER = 'audio-settings-test-pm-bearer';

async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: condition not met in time');
    await delay(5);
  }
}

interface TestApp {
  app: FastifyInstance;
  dir: string;
  pm: FakePipelineManager;
  lecturerToken: string;
  otherLecturerToken: string;
  adminToken: string;
}

async function loginAs(app: FastifyInstance, username: string, password: string): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password, client: 'panel' } });
  return (response.json() as { tokens: { accessToken: string } }).tokens.accessToken;
}

async function startTestApp(): Promise<TestApp> {
  const dir = mkdtempSync(join(tmpdir(), 'core-api-settings-audio-'));
  const pm = new FakePipelineManager({ bearerToken: BEARER });
  const pmBaseUrl = await pm.listen();

  const provisioningPath = join(dir, 'provisioning.json');
  writeFileSync(
    provisioningPath,
    JSON.stringify({ deviceId: 'device-1', hallCode: 'LAC001', hallDisplayName: 'Lecture Hall 1', titlePattern: '{hall} – {date} {time}' }),
  );

  const config = loadConfig({
    NODE_ENV: 'test',
    CORE_API_DB_PATH: join(dir, 'core.db'),
    CORE_API_JWT_SECRET: 'settings-audio-test-secret',
    CORE_API_PROVISIONING_PATH: provisioningPath,
    CORE_API_RECORDINGS_ROOT: join(dir, 'recordings'),
    CORE_API_PM_BASE_URL: pmBaseUrl,
    CORE_API_INTERNAL_BEARER: BEARER,
  });

  const ids = new UlidGenerator();
  const app = await buildApp({ config, clock: new FakeClock(NOW), ids });
  await app.lifecycle.start();
  await waitFor(() => pm.openConnectionCount === 1);

  await app.db
    .insert(users)
    .values([
      {
        id: ids.next(NOW),
        username: 'owner',
        displayName: 'Owner Lecturer',
        role: 'lecturer',
        source: 'local',
        passwordHash: await hashPassword('Password1'),
        mustResetPassword: false,
        disabled: false,
        createdAt: NOW.toISOString(),
      },
      {
        id: ids.next(NOW),
        username: 'other',
        displayName: 'Other Lecturer',
        role: 'lecturer',
        source: 'local',
        passwordHash: await hashPassword('Password1'),
        mustResetPassword: false,
        disabled: false,
        createdAt: NOW.toISOString(),
      },
      {
        id: ids.next(NOW),
        username: 'admin1',
        displayName: 'Admin One',
        role: 'admin',
        source: 'local',
        passwordHash: await hashPassword('Password1'),
        mustResetPassword: false,
        disabled: false,
        createdAt: NOW.toISOString(),
      },
    ])
    .run();

  app.db
    .insert(storageVolumes)
    .values({
      id: ids.next(NOW),
      uuid: 'recordings-volume-1',
      devicePath: '/dev/sda1',
      mountPath: join(dir, 'recordings'),
      filesystem: 'ext4',
      capacityBytes: 1_000_000_000_000,
      freeBytes: 500_000_000_000,
      smartStatus: 'good',
      role: 'recordings',
      state: 'mounted',
      registeredAt: NOW.toISOString(),
    })
    .run();

  const lecturerToken = await loginAs(app, 'owner', 'Password1');
  const otherLecturerToken = await loginAs(app, 'other', 'Password1');
  const adminToken = await loginAs(app, 'admin1', 'Password1');

  return { app, dir, pm, lecturerToken, otherLecturerToken, adminToken };
}

async function stopTestApp(testApp: TestApp): Promise<void> {
  await testApp.app.close();
  await testApp.pm.close();
  rmSync(testApp.dir, { recursive: true, force: true });
}

async function startAndConfirmSession(testApp: TestApp, token: string): Promise<void> {
  await testApp.app.inject({ method: 'POST', url: '/api/v1/recording/start', headers: { authorization: `Bearer ${token}` } });
  await waitFor(() => testApp.pm.calls.some((call) => call.path === '/consumers/record'));
  testApp.pm.publish('evt.pm.consumer.running', { consumerId: 'record:00000001', pgid: 1 });
}

describe('audio controls (openapi.yaml tag: sources — listAudioControls, updateAudioControl)', () => {
  let testApp: TestApp;

  afterEach(async () => {
    await stopTestApp(testApp);
  });

  it('listAudioControls: exactly one row, mic-lecturer', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({ method: 'GET', url: '/api/v1/audio/controls', headers: { authorization: `Bearer ${testApp.lecturerToken}` } });
    expect(response.statusCode).toBe(200);
    const items = (response.json() as { items: Array<{ roleId: string }> }).items;
    expect(items).toHaveLength(1);
    expect(items[0]!.roleId).toBe('mic-lecturer');
  });

  it('updateAudioControl: other roles are not mutable', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({
      method: 'PUT',
      url: '/api/v1/audio/controls/mic-room',
      headers: { authorization: `Bearer ${testApp.adminToken}` },
      payload: { gain: 50 },
    });
    expect(response.statusCode).toBe(422);
    expect((response.json() as { code: string }).code).toBe('config.invalid');
  });

  it('updateAudioControl: gain must be within 0-100', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({
      method: 'PUT',
      url: '/api/v1/audio/controls/mic-lecturer',
      headers: { authorization: `Bearer ${testApp.adminToken}` },
      payload: { gain: 150 },
    });
    expect(response.statusCode).toBe(422);
  });

  it('updateAudioControl: 202 CommandAccepted; requested value enters pending', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({
      method: 'PUT',
      url: '/api/v1/audio/controls/mic-lecturer',
      headers: { authorization: `Bearer ${testApp.adminToken}` },
      payload: { gain: 70, muted: false },
    });
    expect(response.statusCode).toBe(202);
    const body = response.json() as { commandId: string; acceptedAt: string; resolveBySec: number };
    expect(body.commandId).toBeTruthy();
    expect(body.resolveBySec).toBeGreaterThan(0);
  });

  it('updateAudioControl: owner may change controls while a session is active; a non-owner lecturer may not (CG-15)', async () => {
    testApp = await startTestApp();
    await startAndConfirmSession(testApp, testApp.lecturerToken);

    const ownerResponse = await testApp.app.inject({
      method: 'PUT',
      url: '/api/v1/audio/controls/mic-lecturer',
      headers: { authorization: `Bearer ${testApp.lecturerToken}` },
      payload: { gain: 60 },
    });
    expect(ownerResponse.statusCode).toBe(202);

    const otherResponse = await testApp.app.inject({
      method: 'PUT',
      url: '/api/v1/audio/controls/mic-lecturer',
      headers: { authorization: `Bearer ${testApp.otherLecturerToken}` },
      payload: { gain: 20 },
    });
    expect(otherResponse.statusCode).toBe(403);
    expect((otherResponse.json() as { code: string }).code).toBe('not-authorized');

    const adminResponse = await testApp.app.inject({
      method: 'PUT',
      url: '/api/v1/audio/controls/mic-lecturer',
      headers: { authorization: `Bearer ${testApp.adminToken}` },
      payload: { gain: 65 },
    });
    expect(adminResponse.statusCode).toBe(202);
  });

  it('updateAudioControl: with no active session, a non-admin lecturer may still change it (CG-15: no owner to protect)', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({
      method: 'PUT',
      url: '/api/v1/audio/controls/mic-lecturer',
      headers: { authorization: `Bearer ${testApp.otherLecturerToken}` },
      payload: { gain: 55 },
    });
    expect(response.statusCode).toBe(202);
  });

  it('success: PM readback replaces requested state as applied, and a contract-valid audio.control event is published', async () => {
    testApp = await startTestApp();
    const events: AudioControlPayload[] = [];
    testApp.app.bus.subscribe('audio.control', (payload) => events.push(payload));

    await testApp.app.inject({
      method: 'PUT',
      url: '/api/v1/audio/controls/mic-lecturer',
      headers: { authorization: `Bearer ${testApp.adminToken}` },
      payload: { gain: 80, muted: true },
    });

    await waitFor(() => events.length > 0);
    expect(events[0]!.appliedState).toBe('applied');
    expect(events[0]!.gain).toBe(80);
    expect(events[0]!.muted).toBe(true);

    const listResponse = await testApp.app.inject({ method: 'GET', url: '/api/v1/audio/controls', headers: { authorization: `Bearer ${testApp.adminToken}` } });
    const row = (listResponse.json() as { items: Array<{ gain: number; muted: boolean; appliedState: string }> }).items[0]!;
    expect(row.gain).toBe(80);
    expect(row.muted).toBe(true);
    expect(row.appliedState).toBe('applied');
  });

  it('failure: an injected ALSA failure marks appliedState failed with lastError and restores the prior applied gain/mute', async () => {
    testApp = await startTestApp();

    // First, a known-good applied baseline.
    await testApp.app.inject({
      method: 'PUT',
      url: '/api/v1/audio/controls/mic-lecturer',
      headers: { authorization: `Bearer ${testApp.adminToken}` },
      payload: { gain: 40, muted: false },
    });
    await waitFor(() => testApp.pm.calls.some((call) => call.path === '/audio/controls/mic-lecturer'));

    const events: AudioControlPayload[] = [];
    testApp.app.bus.subscribe('audio.control', (payload) => events.push(payload));
    testApp.pm.queueAudioResponse({
      status: 200,
      body: { roleId: 'mic-lecturer', appliedGain: null, appliedMuted: null, appliedState: 'failed', lastError: 'mixer apply failed' },
    });

    await testApp.app.inject({
      method: 'PUT',
      url: '/api/v1/audio/controls/mic-lecturer',
      headers: { authorization: `Bearer ${testApp.adminToken}` },
      payload: { gain: 99, muted: true },
    });

    await waitFor(() => events.length > 0);
    expect(events[0]!.appliedState).toBe('failed');
    expect(events[0]!.lastError).toBe('mixer apply failed');
    // The failed request's optimistic values never become the shown truth — the prior applied gain/mute is restored.
    expect(events[0]!.gain).toBe(40);
    expect(events[0]!.muted).toBe(false);

    const listResponse = await testApp.app.inject({ method: 'GET', url: '/api/v1/audio/controls', headers: { authorization: `Bearer ${testApp.adminToken}` } });
    const row = (listResponse.json() as { items: Array<{ gain: number; muted: boolean; appliedState: string }> }).items[0]!;
    expect(row.gain).toBe(40);
    expect(row.muted).toBe(false);
    expect(row.appliedState).toBe('failed');
  });
});
