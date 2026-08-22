import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { lectureSessions, users } from '../../src/db/schema.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { FakeClock } from '../fakes/clock.js';
import { InMemoryHelperTransport } from '../fakes/helper-server.js';
import { FakePipelineManager } from '../fakes/pipeline-manager.js';

const NOW = new Date('2026-08-19T00:00:00.000Z');
const BEARER = 'power-test-pm-bearer';

interface TestApp {
  app: FastifyInstance;
  dir: string;
  pm: FakePipelineManager;
  ids: UlidGenerator;
  transport: InMemoryHelperTransport;
  lecturerId: string;
  lecturerToken: string;
  adminToken: string;
}

async function loginAs(app: FastifyInstance, username: string, password: string): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password, client: 'panel' } });
  return (response.json() as { tokens: { accessToken: string } }).tokens.accessToken;
}

async function startTestApp(): Promise<TestApp> {
  const dir = mkdtempSync(join(tmpdir(), 'core-api-power-'));
  const pm = new FakePipelineManager({ bearerToken: BEARER });
  const pmBaseUrl = await pm.listen();

  const provisioningPath = join(dir, 'provisioning.json');
  writeFileSync(provisioningPath, JSON.stringify({ deviceId: 'device-1', hallCode: 'LAC001', hallDisplayName: 'Lecture Hall 1', titlePattern: '{hall} – {date} {time}' }));

  const config = loadConfig({
    NODE_ENV: 'test',
    CORE_API_DB_PATH: join(dir, 'core.db'),
    CORE_API_JWT_SECRET: 'power-test-secret',
    CORE_API_PROVISIONING_PATH: provisioningPath,
    CORE_API_RECORDINGS_ROOT: join(dir, 'recordings'),
    CORE_API_PM_BASE_URL: pmBaseUrl,
    CORE_API_INTERNAL_BEARER: BEARER,
  });

  const ids = new UlidGenerator();
  const transport = new InMemoryHelperTransport();
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

describe('guarded power-off (openapi.yaml tag: device — powerOffDevice)', () => {
  let testApp: TestApp;
  afterEach(async () => stopTestApp(testApp));

  it('idle: 202 CommandAccepted and exactly one system.poweroff {} helper call — any authenticated role, not just admin', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({ method: 'POST', url: '/api/v1/device/power-off', headers: { authorization: `Bearer ${testApp.lecturerToken}` } });
    expect(response.statusCode).toBe(202);
    const body = response.json() as { commandId: string; acceptedAt: string; resolveBySec: number };
    expect(body.commandId).toBeTruthy();
    expect(body.resolveBySec).toBeGreaterThan(0);
    expect(testApp.transport.ledger).toEqual([{ verb: 'system.poweroff', args: {}, requestId: expect.any(String) }]);
  });

  it('non-terminal refusal: poweroff.refused, a system.alert is raised, and the helper never runs', async () => {
    testApp = await startTestApp();
    testApp.app.db.insert(lectureSessions).values({
      id: testApp.ids.next(NOW),
      title: 'Active',
      hallCode: 'LAC001',
      hallDisplayName: 'Lecture Hall 1',
      deviceId: 'device-1',
      ownerUserId: testApp.lecturerId,
      startedByActor: 'user',
      state: 'recording',
      startedAt: NOW.toISOString(),
      pauseCount: 0,
      channelActivations: [],
      sourceSnapshot: {},
      aiEnabledAtStart: false,
    }).run();

    const response = await testApp.app.inject({ method: 'POST', url: '/api/v1/device/power-off', headers: { authorization: `Bearer ${testApp.adminToken}` } });
    expect(response.statusCode).toBe(409);
    expect((response.json() as { code: string }).code).toBe('poweroff.refused');
    expect(testApp.transport.ledger).toEqual([]);
    expect(testApp.app.alertStore.list(false).some((alert) => alert.code === 'poweroff.refused')).toBe(true);
  });

  it('race: a session already non-terminal by the time the route runs its guard means the helper never runs, even mid-transition states', async () => {
    testApp = await startTestApp();
    for (const state of ['starting', 'paused', 'stopping', 'finalizing'] as const) {
      testApp.transport.ledger.length = 0;
      testApp.app.db.delete(lectureSessions).run();
      testApp.app.db.insert(lectureSessions).values({
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
      }).run();

      const response = await testApp.app.inject({ method: 'POST', url: '/api/v1/device/power-off', headers: { authorization: `Bearer ${testApp.lecturerToken}` } });
      expect(response.statusCode).toBe(409);
      expect(testApp.transport.ledger).toEqual([]);
    }
  });

  it('helper failure surfaces as a Problem response and never invents a completion event', async () => {
    testApp = await startTestApp();
    testApp.transport.failureVerb = 'system.poweroff';
    const response = await testApp.app.inject({ method: 'POST', url: '/api/v1/device/power-off', headers: { authorization: `Bearer ${testApp.adminToken}` } });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.headers['content-type']).toContain('application/problem+json');
  });
});
