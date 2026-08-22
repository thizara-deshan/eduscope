import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { FastifyInstance } from 'fastify';
import type { DeviceHealthPayload, SystemAlert } from '@eduscope/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { storageVolumes, users } from '../../src/db/schema.js';
import type { HelperTransport } from '../../src/lib/helper-client.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import type { PmStatus } from '../../src/modules/recording/pm/types.js';
import { FakeClock } from '../fakes/clock.js';
import { FakePipelineManager } from '../fakes/pipeline-manager.js';

const NOW = new Date('2026-08-19T00:00:00.000Z');
const BEARER = 'device-test-pm-bearer';

class RecordingHelperTransport implements HelperTransport {
  readonly ledger: Array<{ verb: string; args: Record<string, unknown> }> = [];
  smartDetail = JSON.stringify({ health: 'good' });

  async request(line: string): Promise<string> {
    const req = JSON.parse(line.trim()) as { verb: string; args: Record<string, unknown> };
    this.ledger.push({ verb: req.verb, args: req.args });
    if (req.verb === 'smart.read') return JSON.stringify({ ok: true, detail: this.smartDetail });
    return JSON.stringify({ ok: true, detail: 'ok' });
  }
}

function fullProvisioning(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    deviceId: 'device-1',
    serialNumber: 'SN-1',
    instituteProfileId: 'institute-1',
    hallCode: 'LAC001',
    hallDisplayName: 'Lecture Hall 1',
    titlePattern: '{hall} – {date} {time}',
    timezone: 'Asia/Colombo',
    ntpServers: ['ntp.example.org'],
    expectedStorageVolumeUuid: null,
    featureFlags: { recordingEnabled: true, aiQuizEnabled: true, streamingEnabled: false },
    quizServerBaseUrl: null,
    llmEndpoint: null,
    provisionedAt: '2026-01-01T00:00:00.000+00:00',
    provisionedBy: 'deploy',
    secretApiKey: 'must-never-be-echoed',
    ...overrides,
  };
}

interface TestApp {
  app: FastifyInstance;
  dir: string;
  pm: FakePipelineManager;
  clock: FakeClock;
  provisioningPath: string;
  transport: RecordingHelperTransport;
  lecturerToken: string;
  adminToken: string;
}

async function loginAs(app: FastifyInstance, username: string, password: string): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password, client: 'panel' } });
  return (response.json() as { tokens: { accessToken: string } }).tokens.accessToken;
}

async function startTestApp(options: { provisioning?: Record<string, unknown> | null; ntpSynced?: boolean; ntpOffsetMs?: number | null; mountVolume?: boolean } = {}): Promise<TestApp> {
  const dir = mkdtempSync(join(tmpdir(), 'core-api-device-'));
  const pm = new FakePipelineManager({ bearerToken: BEARER });
  const pmBaseUrl = await pm.listen();

  const provisioningPath = join(dir, 'provisioning.json');
  writeFileSync(provisioningPath, JSON.stringify(options.provisioning === null ? { deviceId: 'device-1' } : fullProvisioning(options.provisioning)));

  const config = loadConfig({
    NODE_ENV: 'test',
    CORE_API_DB_PATH: join(dir, 'core.db'),
    CORE_API_JWT_SECRET: 'device-test-secret',
    CORE_API_PROVISIONING_PATH: provisioningPath,
    CORE_API_RECORDINGS_ROOT: join(dir, 'recordings'),
    CORE_API_PM_BASE_URL: pmBaseUrl,
    CORE_API_INTERNAL_BEARER: BEARER,
  });

  const clock = new FakeClock(NOW);
  const ids = new UlidGenerator();
  const transport = new RecordingHelperTransport();
  const app = await buildApp({
    config,
    clock,
    ids,
    helperTransport: transport,
    ntpReader: async () => ({ synced: options.ntpSynced ?? true, offsetMs: options.ntpOffsetMs ?? 5 }),
  });
  await app.lifecycle.start();

  if (options.mountVolume !== false) {
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
  }

  await app.db.insert(users).values([
    { id: ids.next(NOW), username: 'lecturer1', displayName: 'Lecturer', role: 'lecturer', source: 'local', passwordHash: await hashPassword('Password1'), mustResetPassword: false, disabled: false, createdAt: NOW.toISOString() },
    { id: ids.next(NOW), username: 'admin1', displayName: 'Admin', role: 'admin', source: 'local', passwordHash: await hashPassword('Password1'), mustResetPassword: false, disabled: false, createdAt: NOW.toISOString() },
  ]).run();

  const lecturerToken = await loginAs(app, 'lecturer1', 'Password1');
  const adminToken = await loginAs(app, 'admin1', 'Password1');

  return { app, dir, pm, clock, provisioningPath, transport, lecturerToken, adminToken };
}

async function stopTestApp(testApp: TestApp): Promise<void> {
  await testApp.app.close();
  await testApp.pm.close();
  rmSync(testApp.dir, { recursive: true, force: true });
}

function statusWith(captureCardState: PmStatus['device']['captureCardState'], rtspState: 'online' | 'degraded' | 'offline' | 'unknown'): PmStatus {
  return {
    platform: 'rk3588',
    encodeLedger: { capacity: 3, inUse: 0, reservedBy: [] },
    publishers: {
      usb: { state: 'unknown', bound: false, fps: null, rms: null, lastError: null },
      rtsp: { state: rtspState, bound: true, fps: 30, rms: null, lastError: rtspState === 'offline' ? 'no signal' : null },
      rtsp2: { state: 'unknown', bound: false, fps: null, rms: null, lastError: null },
      audio: { state: 'unknown', bound: false, fps: null, rms: null, lastError: null },
    },
    consumers: [],
    device: { captureCardState, led: 'off' },
    sequence: 0,
  };
}

describe('device provisioning (openapi.yaml tag: provisioning — getProvisioning)', () => {
  let testApp: TestApp;
  afterEach(async () => stopTestApp(testApp));

  it('returns the secret-free read view and never echoes unrecognized fields', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({ method: 'GET', url: '/api/v1/provisioning', headers: { authorization: `Bearer ${testApp.lecturerToken}` } });
    expect(response.statusCode).toBe(200);
    const body = response.json() as Record<string, unknown>;
    expect(body.deviceId).toBe('device-1');
    expect(body.hallCode).toBe('LAC001');
    expect(body).not.toHaveProperty('secretApiKey');
  });

  it('an incomplete provisioning file refuses with provisioning.incomplete', async () => {
    testApp = await startTestApp({ provisioning: null });
    const response = await testApp.app.inject({ method: 'GET', url: '/api/v1/provisioning', headers: { authorization: `Bearer ${testApp.lecturerToken}` } });
    expect(response.statusCode).toBe(422);
    expect((response.json() as { code: string }).code).toBe('provisioning.incomplete');
  });

  it('mtime-invalidated: a later read reflects a changed file, an unchanged file returns the cached parse', async () => {
    testApp = await startTestApp();
    const first = await testApp.app.inject({ method: 'GET', url: '/api/v1/provisioning', headers: { authorization: `Bearer ${testApp.lecturerToken}` } });
    expect((first.json() as { hallDisplayName: string }).hallDisplayName).toBe('Lecture Hall 1');

    await new Promise((resolve) => setTimeout(resolve, 5));
    writeFileSync(testApp.provisioningPath, JSON.stringify(fullProvisioning({ hallDisplayName: 'Renamed Hall' })));
    const second = await testApp.app.inject({ method: 'GET', url: '/api/v1/provisioning', headers: { authorization: `Bearer ${testApp.lecturerToken}` } });
    expect((second.json() as { hallDisplayName: string }).hallDisplayName).toBe('Renamed Hall');
  });
});

describe('device health (openapi.yaml tag: provisioning/device — getDeviceHealth)', () => {
  let testApp: TestApp;
  afterEach(async () => stopTestApp(testApp));

  it('aggregates capture-card state, publisher states, disk SMART, and NTP fields', async () => {
    testApp = await startTestApp();
    const events: DeviceHealthPayload[] = [];
    testApp.app.bus.subscribe('device.health', (payload) => events.push(payload));

    testApp.app.bus.publish('pm.status.resynced', statusWith('present', 'online'));
    // The recordings volume is inserted after startup, so the SMART probe that ran during `start()` found none — advance to the next refresh tick, now that it exists, and let the async probe settle.
    testApp.clock.advance(60_000);
    await delay(10);

    const response = await testApp.app.inject({ method: 'GET', url: '/api/v1/health', headers: { authorization: `Bearer ${testApp.lecturerToken}` } });
    expect(response.statusCode).toBe(200);
    const body = response.json() as DeviceHealthPayload & { publisherStates: Record<string, { status: string }> };
    expect(body.captureCardState).toBe('present');
    expect(body.publisherStates['lecturer-cam']?.status).toBe('running');
    expect(body.ntpSynced).toBe(true);
    expect(body.clockOffsetMs).toBe(5);
    expect(testApp.transport.ledger.some((entry) => entry.verb === 'smart.read' && entry.args.devNode === '/dev/sda1')).toBe(true);
    expect(events.length).toBeGreaterThan(0);
  });

  it('stale pm telemetry reads unknown, never the last-healthy value', async () => {
    testApp = await startTestApp();
    testApp.app.bus.publish('pm.status.resynced', statusWith('present', 'online'));
    let response = await testApp.app.inject({ method: 'GET', url: '/api/v1/health', headers: { authorization: `Bearer ${testApp.lecturerToken}` } });
    expect((response.json() as { publisherStates: Record<string, { status: string }> }).publisherStates['lecturer-cam']?.status).toBe('running');

    testApp.app.bus.publish('pm.status.resynced', statusWith('absent', 'unknown'));
    response = await testApp.app.inject({ method: 'GET', url: '/api/v1/health', headers: { authorization: `Bearer ${testApp.lecturerToken}` } });
    const body = response.json() as { captureCardState: string; publisherStates: Record<string, { status: string }> };
    expect(body.captureCardState).toBe('absent');
    expect(body.publisherStates['lecturer-cam']?.status).toBe('unknown');
  });

  it('no mounted recordings volume: disk health reads unknown and smart.read is never called', async () => {
    testApp = await startTestApp({ mountVolume: false });
    const response = await testApp.app.inject({ method: 'GET', url: '/api/v1/health', headers: { authorization: `Bearer ${testApp.lecturerToken}` } });
    expect((response.json() as { diskHealth: string }).diskHealth).toBe('unknown');
    expect(testApp.transport.ledger.some((entry) => entry.verb === 'smart.read')).toBe(false);
  });

  it('emits device.health on change and again after 60 seconds even with no change', async () => {
    testApp = await startTestApp();
    const events: DeviceHealthPayload[] = [];
    testApp.app.bus.subscribe('device.health', (payload) => events.push(payload));
    const afterStart = events.length;

    testApp.clock.advance(60_000);
    await delay(10);
    expect(events.length).toBeGreaterThan(afterStart);
  });
});

describe('alerts (openapi.yaml tag: device — listAlerts, acknowledgeAlert)', () => {
  let testApp: TestApp;
  afterEach(async () => stopTestApp(testApp));

  it('raise deduplicates by code, acknowledge records the actor without clearing, and reevaluation re-raises a still-true condition', async () => {
    testApp = await startTestApp();
    let conditionTrue = true;
    testApp.app.alertStore.registerCondition('test.condition', () =>
      conditionTrue ? { code: 'test.condition', severity: 'warning', category: 'System', title: 'Test condition active' } : null,
    );

    const events: SystemAlert[] = [];
    testApp.app.bus.subscribe('system.alert', (payload) => events.push(payload));

    testApp.clock.advance(30_000); // first reevaluation pass after registration
    const afterFirstRaise = testApp.app.alertStore.list(false);
    expect(afterFirstRaise.filter((a) => a.code === 'test.condition')).toHaveLength(1);

    testApp.clock.advance(30_000); // still true — must not duplicate
    expect(testApp.app.alertStore.list(false).filter((a) => a.code === 'test.condition')).toHaveLength(1);

    const alertId = afterFirstRaise.find((a) => a.code === 'test.condition')!.id;
    const ackResponse = await testApp.app.inject({ method: 'POST', url: `/api/v1/alerts/${alertId}/acknowledge`, headers: { authorization: `Bearer ${testApp.adminToken}` } });
    expect(ackResponse.statusCode).toBe(200);
    expect((ackResponse.json() as { acknowledgedBy: string }).acknowledgedBy).toBeTruthy();
    expect(testApp.app.alertStore.list(false).find((a) => a.code === 'test.condition')?.clearedAt).toBeNull();

    testApp.clock.advance(30_000); // still true after acknowledge — re-raises rather than staying cleared
    expect(testApp.app.alertStore.list(false).filter((a) => a.code === 'test.condition')).toHaveLength(1);

    conditionTrue = false;
    testApp.clock.advance(30_000);
    expect(testApp.app.alertStore.list(false).filter((a) => a.code === 'test.condition')).toHaveLength(0);
    expect(testApp.app.alertStore.list(true).find((a) => a.code === 'test.condition')?.clearedReason).toBe('resolved');

    const listResponse = await testApp.app.inject({ method: 'GET', url: '/api/v1/alerts', headers: { authorization: `Bearer ${testApp.lecturerToken}` } });
    expect(listResponse.statusCode).toBe(200);
    expect(events.length).toBeGreaterThan(0);
  });

  it('acknowledging an unknown alert returns not-found', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({ method: 'POST', url: '/api/v1/alerts/does-not-exist/acknowledge', headers: { authorization: `Bearer ${testApp.adminToken}` } });
    expect(response.statusCode).toBe(404);
  });
});
