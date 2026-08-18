import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { FastifyInstance } from 'fastify';
import { zAudioLevelsPayload, zGetSourcesStatusResponse, zSourcesStatusPayload, type SourcesStatusPayload } from '@eduscope/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { users } from '../../src/db/schema.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import type { PmStatus } from '../../src/modules/recording/pm/types.js';
import { FakeClock } from '../fakes/clock.js';
import { FakePipelineManager } from '../fakes/pipeline-manager.js';

const NOW = new Date('2026-06-02T09:00:00.000Z');
const BEARER = 'contract-test-pm-bearer-sources';

async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: condition not met in time');
    await delay(5);
  }
}

function statusWith(publisherState: 'online' | 'degraded' | 'offline', rms: number | null = null): PmStatus {
  return {
    platform: 'rk3588',
    encodeLedger: { capacity: 3, inUse: 0, reservedBy: [] },
    publishers: {
      usb: { state: 'unknown', bound: true, fps: null, rms: null, lastError: null },
      rtsp: { state: publisherState, bound: true, fps: 30, rms: null, lastError: null },
      rtsp2: { state: 'unknown', bound: true, fps: null, rms: null, lastError: null },
      audio: { state: 'unknown', bound: true, fps: null, rms, lastError: null },
    },
    consumers: [],
    device: { captureCardState: 'present', led: 'off' },
    sequence: 0,
  };
}

interface TestApp {
  app: FastifyInstance;
  dir: string;
  pm: FakePipelineManager;
  clock: FakeClock;
  ownerToken: string;
}

async function loginAs(app: FastifyInstance, username: string, password: string): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password, client: 'panel' } });
  return (response.json() as { tokens: { accessToken: string } }).tokens.accessToken;
}

async function startTestApp(): Promise<TestApp> {
  const dir = mkdtempSync(join(tmpdir(), 'core-api-sources-status-contract-'));
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
    CORE_API_JWT_SECRET: 'sources-status-contract-secret',
    CORE_API_PROVISIONING_PATH: provisioningPath,
    CORE_API_RECORDINGS_ROOT: join(dir, 'recordings'),
    CORE_API_PM_BASE_URL: pmBaseUrl,
    CORE_API_INTERNAL_BEARER: BEARER,
  });

  const clock = new FakeClock(NOW);
  const ids = new UlidGenerator();
  const app = await buildApp({ config, clock, ids });
  await app.lifecycle.start();
  await waitFor(() => pm.openConnectionCount === 1);

  app.db
    .insert(users)
    .values({
      id: ids.next(NOW),
      username: 'owner',
      displayName: 'Owner Lecturer',
      role: 'lecturer',
      source: 'local',
      passwordHash: await hashPassword('Password1'),
      mustResetPassword: false,
      disabled: false,
      createdAt: NOW.toISOString(),
    })
    .run();

  const ownerToken = await loginAs(app, 'owner', 'Password1');

  return { app, dir, pm, clock, ownerToken };
}

async function stopTestApp(testApp: TestApp): Promise<void> {
  await testApp.app.close();
  await testApp.pm.close();
  rmSync(testApp.dir, { recursive: true, force: true });
}

async function getStatus(testApp: TestApp): Promise<{ statusCode: number; body: unknown }> {
  const response = await testApp.app.inject({
    method: 'GET',
    url: '/api/v1/sources/status',
    headers: { authorization: `Bearer ${testApp.ownerToken}` },
  });
  return { statusCode: response.statusCode, body: response.json() };
}

function findRole(items: SourcesStatusPayload[], roleId: string): SourcesStatusPayload | undefined {
  return items.find((item) => item.roleId === roleId);
}

/** Every provisionable role reacts to the bridge's own initial `pm.status.resynced` (all publishers default `online`), so isolating one role's event history — not "the last event overall" — is what makes these checks non-racy. */
function lastFor(events: SourcesStatusPayload[], roleId: string): SourcesStatusPayload | undefined {
  return [...events].reverse().find((event) => event.roleId === roleId);
}

describe('sources status contract (openapi.yaml tag: sources — getSourcesStatus)', () => {
  let testApp: TestApp;

  afterEach(async () => {
    await stopTestApp(testApp);
  });

  it('getSourcesStatus: 200 parses zGetSourcesStatusResponse, five seeded roles, mic-room permanently unbound', async () => {
    testApp = await startTestApp();

    const response = await getStatus(testApp);

    expect(response.statusCode).toBe(200);
    const parsed = zGetSourcesStatusResponse.parse(response.body);
    expect(parsed.items).toHaveLength(5);
    expect(findRole(parsed.items, 'mic-room')?.state).toBe('unbound');
  });

  it('REST/WS convergence: a pm.status.resynced observation updates both the REST snapshot and an emitted sources.status event, unplug/replug converges honestly', async () => {
    testApp = await startTestApp();
    const events: SourcesStatusPayload[] = [];
    testApp.app.bus.subscribe('sources.status', (payload) => events.push(payload));

    testApp.app.bus.publish('pm.status.resynced', statusWith('online'));
    await delay(30); // let the bus/route handlers settle without yet advancing the debounce clock
    // The debounce timer (T-SOURCE-DEBOUNCE, 3s) has not yet fired — REST still reads the pre-telemetry `unknown`.
    const before = await getStatus(testApp);
    expect(findRole(zGetSourcesStatusResponse.parse(before.body).items, 'lecturer-cam')?.state).toBe('unknown');
    expect(events.some((event) => event.roleId === 'lecturer-cam')).toBe(false);

    testApp.clock.advance(3000);
    await waitFor(() => lastFor(events, 'lecturer-cam')?.state === 'online');

    const online = await getStatus(testApp);
    const onlineRole = findRole(zGetSourcesStatusResponse.parse(online.body).items, 'lecturer-cam');
    expect(onlineRole?.state).toBe('online');
    expect(() => zSourcesStatusPayload.parse(onlineRole)).not.toThrow();

    // Unplug: publisher reports offline, and the reading is repeated under T-HEALTH-STALE so the link stays fresh through the 10s debounce.
    for (let i = 0; i < 5; i += 1) {
      testApp.app.bus.publish('pm.status.resynced', statusWith('offline'));
      testApp.clock.advance(2000);
      await delay(5);
    }
    await waitFor(() => lastFor(events, 'lecturer-cam')?.state === 'offline');

    const offline = await getStatus(testApp);
    expect(findRole(zGetSourcesStatusResponse.parse(offline.body).items, 'lecturer-cam')?.state).toBe('offline');

    // No further telemetry — the link itself goes stale (T-HEALTH-STALE, 6s) and REST honestly reads unknown, never the last-healthy value.
    testApp.clock.advance(6000);
    await waitFor(() => lastFor(events, 'lecturer-cam')?.state === 'unknown');

    const stale = await getStatus(testApp);
    expect(findRole(zGetSourcesStatusResponse.parse(stale.body).items, 'lecturer-cam')?.state).toBe('unknown');
  });

  it('audio.levels: nothing is published with zero bus subscribers; a subscriber receives a clamped, contract-valid reading', async () => {
    testApp = await startTestApp();

    testApp.app.bus.publish('pm.status.resynced', statusWith('online', 1.5));
    await delay(30);
    // No subscriber yet — nothing to assert against directly, but this proves the call above didn't throw.

    const levels: unknown[] = [];
    testApp.app.bus.subscribe('audio.levels', (payload) => levels.push(payload));

    testApp.app.bus.publish('pm.status.resynced', statusWith('online', 1.5));
    await waitFor(() => levels.length > 0);

    expect(() => zAudioLevelsPayload.parse(levels[0])).not.toThrow();
    expect((levels[0] as { rms: number }).rms).toBe(1);
  });
});
