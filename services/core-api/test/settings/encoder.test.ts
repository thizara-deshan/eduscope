import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { FastifyInstance } from 'fastify';
import type { EncodingProfile } from '@eduscope/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { channelConfigs, storageVolumes, users } from '../../src/db/schema.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { FakeClock } from '../fakes/clock.js';
import { FakePipelineManager } from '../fakes/pipeline-manager.js';
import { eq } from 'drizzle-orm';

const NOW = new Date('2026-08-19T00:00:00.000Z');
const BEARER = 'encoder-settings-test-pm-bearer';

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
  adminToken: string;
}

async function loginAs(app: FastifyInstance, username: string, password: string): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password, client: 'panel' } });
  return (response.json() as { tokens: { accessToken: string } }).tokens.accessToken;
}

async function startTestApp(): Promise<TestApp> {
  const dir = mkdtempSync(join(tmpdir(), 'core-api-settings-encoder-'));
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
    CORE_API_JWT_SECRET: 'settings-encoder-test-secret',
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
        username: 'lecturer1',
        displayName: 'Lecturer One',
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

  // A streaming target is required for CH-01 preflight to proceed; B-25 (stream-target CRUD)
  // is a later task, so the test seeds the config column directly, same as other pre-B-25 tests.
  app.db.update(channelConfigs).set({ streamTargetIds: ['01ARZ3NDEKTSV4RRFFQ69G5FAV'] }).where(eq(channelConfigs.channelId, 'streaming')).run();

  const lecturerToken = await loginAs(app, 'lecturer1', 'Password1');
  const adminToken = await loginAs(app, 'admin1', 'Password1');

  return { app, dir, pm, lecturerToken, adminToken };
}

async function stopTestApp(testApp: TestApp): Promise<void> {
  await testApp.app.close();
  await testApp.pm.close();
  rmSync(testApp.dir, { recursive: true, force: true });
}

describe('encoder settings (openapi.yaml tag: settings — getEncoderSettings, updateEncoderSettings)', () => {
  let testApp: TestApp;

  afterEach(async () => {
    await stopTestApp(testApp);
  });

  it('getEncoderSettings: without channelId returns the device-default profile', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({ method: 'GET', url: '/api/v1/settings/encoder', headers: { authorization: `Bearer ${testApp.adminToken}` } });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { profile: EncodingProfile; capabilities: unknown };
    expect(body.profile.scope).toBe('device-default');
    expect(body.profile.channelId).toBeNull();
    expect(body.profile.videoBitrateKbps).toBe(4000);
    expect(body.capabilities).toBeTruthy();
  });

  it('getEncoderSettings: with a channelId that has no override, inherits the device default', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({
      method: 'GET',
      url: '/api/v1/settings/encoder?channelId=streaming',
      headers: { authorization: `Bearer ${testApp.adminToken}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { profile: EncodingProfile };
    expect(body.profile.scope).toBe('device-default');
    expect(body.profile.channelId).toBeNull();
  });

  it('getEncoderSettings: with a channelId that has an override, returns that override', async () => {
    testApp = await startTestApp();
    await testApp.app.inject({
      method: 'PUT',
      url: '/api/v1/settings/encoder',
      headers: { authorization: `Bearer ${testApp.adminToken}` },
      payload: { channelId: 'streaming', videoBitrateKbps: 6000 },
    });

    const response = await testApp.app.inject({
      method: 'GET',
      url: '/api/v1/settings/encoder?channelId=streaming',
      headers: { authorization: `Bearer ${testApp.adminToken}` },
    });
    const body = response.json() as { profile: EncodingProfile };
    expect(body.profile.scope).toBe('channel');
    expect(body.profile.channelId).toBe('streaming');
    expect(body.profile.videoBitrateKbps).toBe(6000);
  });

  it('updateEncoderSettings: bitrate must be within 2000-8000 Kbps', async () => {
    testApp = await startTestApp();
    const tooLow = await testApp.app.inject({
      method: 'PUT',
      url: '/api/v1/settings/encoder',
      headers: { authorization: `Bearer ${testApp.adminToken}` },
      payload: { videoBitrateKbps: 1999 },
    });
    expect(tooLow.statusCode).toBe(422); // rejected by the contract schema's own 2000-8000 bound

    const tooHigh = await testApp.app.inject({
      method: 'PUT',
      url: '/api/v1/settings/encoder',
      headers: { authorization: `Bearer ${testApp.adminToken}` },
      payload: { videoBitrateKbps: 8001 },
    });
    expect(tooHigh.statusCode).toBe(422);
  });

  it('updateEncoderSettings: an unsupported capability value (gop) is rejected, absent not inert (INV-EP-1)', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({
      method: 'PUT',
      url: '/api/v1/settings/encoder',
      headers: { authorization: `Bearer ${testApp.adminToken}` },
      payload: { gop: 45 },
    });
    expect(response.statusCode).toBe(422);
    expect((response.json() as { code: string }).code).toBe('config.invalid');
  });

  it('updateEncoderSettings: absent/null channelId writes the device default', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({
      method: 'PUT',
      url: '/api/v1/settings/encoder',
      headers: { authorization: `Bearer ${testApp.adminToken}` },
      payload: { channelId: null, videoBitrateKbps: 5000 },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as EncodingProfile;
    expect(body.scope).toBe('device-default');
    expect(body.videoBitrateKbps).toBe(5000);
  });

  it('updateEncoderSettings: a non-null channelId writes only that channel — the device default is untouched', async () => {
    testApp = await startTestApp();
    await testApp.app.inject({
      method: 'PUT',
      url: '/api/v1/settings/encoder',
      headers: { authorization: `Bearer ${testApp.adminToken}` },
      payload: { channelId: 'streaming', videoBitrateKbps: 7000, framerate: 25 },
    });

    const defaultResponse = await testApp.app.inject({ method: 'GET', url: '/api/v1/settings/encoder', headers: { authorization: `Bearer ${testApp.adminToken}` } });
    const defaultProfile = (defaultResponse.json() as { profile: EncodingProfile }).profile;
    expect(defaultProfile.videoBitrateKbps).toBe(4000); // untouched
    expect(defaultProfile.scope).toBe('device-default');
  });

  it('updateEncoderSettings requires admin', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({
      method: 'PUT',
      url: '/api/v1/settings/encoder',
      headers: { authorization: `Bearer ${testApp.lecturerToken}` },
      payload: { videoBitrateKbps: 5000 },
    });
    expect(response.statusCode).toBe(403);
  });

  it('a streaming override reaches the next PM live-start profile as Bps, while local record retains its own default', async () => {
    testApp = await startTestApp();

    await testApp.app.inject({
      method: 'PUT',
      url: '/api/v1/settings/encoder',
      headers: { authorization: `Bearer ${testApp.adminToken}` },
      payload: { channelId: 'streaming', videoBitrateKbps: 6000, framerate: 25 },
    });

    // Start local recording first — its effective profile must still be the untouched device default.
    await testApp.app.inject({ method: 'POST', url: '/api/v1/recording/start', headers: { authorization: `Bearer ${testApp.lecturerToken}` } });
    await waitFor(() => testApp.pm.calls.some((call) => call.path === '/consumers/record'));
    const recordCall = testApp.pm.calls.find((call) => call.path === '/consumers/record')!;
    expect((recordCall.body as { videoBitrateBps: number }).videoBitrateBps).toBe(4_000_000);
    expect((recordCall.body as { fps: number }).fps).toBe(30);

    // Enable streaming — its effective profile must carry the override, converted to Bps.
    await testApp.app.inject({ method: 'POST', url: '/api/v1/channels/streaming/enable', headers: { authorization: `Bearer ${testApp.lecturerToken}` } });
    await waitFor(() => testApp.pm.calls.some((call) => call.path === '/consumers/live'));
    const liveCall = testApp.pm.calls.find((call) => call.path === '/consumers/live')!;
    expect((liveCall.body as { videoBitrateBps: number }).videoBitrateBps).toBe(6_000_000);
    expect((liveCall.body as { fps: number }).fps).toBe(25);
  });
});
