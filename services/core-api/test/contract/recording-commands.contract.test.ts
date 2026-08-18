import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { FastifyInstance } from 'fastify';
import { zPauseRecordingResponse, zProblem, zResumeRecordingResponse, zStopRecordingResponse } from '@eduscope/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { lectureSessions, storageVolumes, users } from '../../src/db/schema.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { FakeClock } from '../fakes/clock.js';
import { FakePipelineManager } from '../fakes/pipeline-manager.js';

const NOW = new Date('2026-04-02T09:00:00.000Z');
const BEARER = 'contract-test-pm-bearer-commands';
const FIRST_CONSUMER_ID = 'record:00000001';

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
  ownerToken: string;
  otherLecturerToken: string;
}

async function loginAs(app: FastifyInstance, username: string, password: string): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password, client: 'panel' } });
  return (response.json() as { tokens: { accessToken: string } }).tokens.accessToken;
}

async function startTestApp(): Promise<TestApp> {
  const dir = mkdtempSync(join(tmpdir(), 'core-api-recording-commands-contract-'));
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
    CORE_API_JWT_SECRET: 'recording-commands-contract-secret',
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
  app.db
    .insert(users)
    .values({
      id: ids.next(NOW),
      username: 'otherlecturer',
      displayName: 'Other Lecturer',
      role: 'lecturer',
      source: 'local',
      passwordHash: await hashPassword('Password1'),
      mustResetPassword: false,
      disabled: false,
      createdAt: NOW.toISOString(),
    })
    .run();

  app.db
    .insert(storageVolumes)
    .values({
      id: ids.next(NOW),
      uuid: 'recordings-volume-1',
      devicePath: '/dev/sda1',
      mountPath: '/media/eduscope',
      filesystem: 'ext4',
      capacityBytes: 1_000_000_000_000,
      freeBytes: 500_000_000_000,
      smartStatus: 'good',
      role: 'recordings',
      state: 'mounted',
      registeredAt: NOW.toISOString(),
    })
    .run();

  const ownerToken = await loginAs(app, 'owner', 'Password1');
  const otherLecturerToken = await loginAs(app, 'otherlecturer', 'Password1');

  return { app, dir, pm, ownerToken, otherLecturerToken };
}

async function stopTestApp(testApp: TestApp): Promise<void> {
  await testApp.app.close();
  await testApp.pm.close();
  rmSync(testApp.dir, { recursive: true, force: true });
}

async function startAndConfirm(testApp: TestApp): Promise<void> {
  await testApp.app.inject({ method: 'POST', url: '/api/v1/recording/start', headers: { authorization: `Bearer ${testApp.ownerToken}` } });
  await waitFor(() => testApp.pm.calls.some((call) => call.path === '/consumers/record'));
  testApp.pm.publish('evt.pm.consumer.running', { consumerId: FIRST_CONSUMER_ID, pgid: 1 });
  await waitFor(() => testApp.app.db.select().from(lectureSessions).all()[0]?.state === 'recording');
}

describe('recording contract (openapi.yaml tag: recording — pauseRecording, resumeRecording, stopRecording)', () => {
  let testApp: TestApp;

  afterEach(async () => {
    await stopTestApp(testApp);
  });

  it('pauseRecording: 202 parses zPauseRecordingResponse', async () => {
    testApp = await startTestApp();
    await startAndConfirm(testApp);

    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/recording/pause',
      headers: { authorization: `Bearer ${testApp.ownerToken}` },
    });

    expect(response.statusCode).toBe(202);
    expect(() => zPauseRecordingResponse.parse(response.json())).not.toThrow();
  });

  it('pauseRecording: 403 not-authorized parses zProblem for a non-owner lecturer', async () => {
    testApp = await startTestApp();
    await startAndConfirm(testApp);

    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/recording/pause',
      headers: { authorization: `Bearer ${testApp.otherLecturerToken}` },
    });

    expect(response.statusCode).toBe(403);
    const problem = zProblem.parse(response.json());
    expect(problem.code).toBe('not-authorized');
  });

  it('resumeRecording: 202 parses zResumeRecordingResponse once paused', async () => {
    testApp = await startTestApp();
    await startAndConfirm(testApp);
    await testApp.app.inject({ method: 'POST', url: '/api/v1/recording/pause', headers: { authorization: `Bearer ${testApp.ownerToken}` } });
    await waitFor(() => testApp.pm.calls.some((call) => call.path === `/consumers/${FIRST_CONSUMER_ID}/stop`));
    testApp.pm.publish('evt.pm.consumer.eos', { consumerId: FIRST_CONSUMER_ID });
    await waitFor(() => testApp.app.db.select().from(lectureSessions).all()[0]?.state === 'paused');

    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/recording/resume',
      headers: { authorization: `Bearer ${testApp.ownerToken}` },
    });

    expect(response.statusCode).toBe(202);
    expect(() => zResumeRecordingResponse.parse(response.json())).not.toThrow();
  });

  it('resumeRecording: 409 session.not-active parses zProblem when nothing is active', async () => {
    testApp = await startTestApp();

    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/recording/resume',
      headers: { authorization: `Bearer ${testApp.ownerToken}` },
    });

    expect(response.statusCode).toBe(409);
    const problem = zProblem.parse(response.json());
    expect(problem.code).toBe('session.not-active');
  });

  it('stopRecording: 202 parses zStopRecordingResponse', async () => {
    testApp = await startTestApp();
    await startAndConfirm(testApp);

    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/recording/stop',
      headers: { authorization: `Bearer ${testApp.ownerToken}` },
    });

    expect(response.statusCode).toBe(202);
    expect(() => zStopRecordingResponse.parse(response.json())).not.toThrow();
  });

  it('stopRecording: 403 not-authorized parses zProblem for a non-owner lecturer', async () => {
    testApp = await startTestApp();
    await startAndConfirm(testApp);

    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/recording/stop',
      headers: { authorization: `Bearer ${testApp.otherLecturerToken}` },
    });

    expect(response.statusCode).toBe(403);
    const problem = zProblem.parse(response.json());
    expect(problem.code).toBe('not-authorized');
  });
});
