import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { FastifyInstance } from 'fastify';
import { zGetAiCountdownResponse, zGenerateNowResponse, zProblem, zSetAiIntervalResponse } from '@eduscope/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { storageVolumes, users } from '../../src/db/schema.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { FakeAiServices } from '../fakes/ai-services.js';
import { FakeClock } from '../fakes/clock.js';
import { FakePipelineManager } from '../fakes/pipeline-manager.js';

const NOW = new Date('2026-08-20T00:00:00.000Z');
const BEARER = 'contract-test-internal-bearer-ai';
const FIRST_CONSUMER_ID = 'record:00000001';

function writeProvisioning(dir: string): string {
  const path = join(dir, 'provisioning.json');
  writeFileSync(
    path,
    JSON.stringify({
      deviceId: 'device-1',
      serialNumber: null,
      instituteProfileId: 'institute-1',
      hallCode: 'LAC001',
      hallDisplayName: 'Lecture Hall 1',
      titlePattern: '{hall} – {date} {time}',
      timezone: 'Asia/Colombo',
      ntpServers: [],
      expectedStorageVolumeUuid: null,
      featureFlags: { recordingEnabled: true, aiQuizEnabled: true, streamingEnabled: false },
      quizServerBaseUrl: null,
      llmEndpoint: 'http://127.0.0.1:9/llm',
      provisionedAt: '2026-01-01T00:00:00.000+00:00',
      provisionedBy: 'deploy',
    }),
  );
  return path;
}

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
  ai: FakeAiServices;
  token: string;
}

async function startTestApp(): Promise<TestApp> {
  const dir = mkdtempSync(join(tmpdir(), 'core-api-ai-countdown-contract-'));
  const pm = new FakePipelineManager({ bearerToken: BEARER });
  const pmBaseUrl = await pm.listen();
  const ai = new FakeAiServices({ bearerToken: BEARER });
  const aiBaseUrls = await ai.listen();
  const provisioningPath = writeProvisioning(dir);

  const config = loadConfig({
    NODE_ENV: 'test',
    CORE_API_DB_PATH: join(dir, 'core.db'),
    CORE_API_JWT_SECRET: 'ai-countdown-contract-secret',
    CORE_API_PROVISIONING_PATH: provisioningPath,
    CORE_API_RECORDINGS_ROOT: join(dir, 'recordings'),
    CORE_API_RUNTIME_DIR: join(dir, 'runtime'),
    CORE_API_PM_BASE_URL: pmBaseUrl,
    CORE_API_INTERNAL_BEARER: BEARER,
  });
  const ids = new UlidGenerator();
  const app = await buildApp({ config, clock: new FakeClock(NOW), ids, aiBaseUrls });
  await app.lifecycle.start();
  await waitFor(() => pm.openConnectionCount === 1);

  await app.db
    .insert(users)
    .values({
      id: ids.next(NOW),
      username: 'lecturer1',
      displayName: 'Lecturer One',
      role: 'lecturer',
      source: 'local',
      passwordHash: await hashPassword('Password1'),
      mustResetPassword: false,
      disabled: false,
      createdAt: NOW.toISOString(),
    })
    .run();
  await app.db
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

  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'lecturer1', password: 'Password1', client: 'panel' } });
  const token = (login.json() as { tokens: { accessToken: string } }).tokens.accessToken;

  return { app, dir, pm, ai, token };
}

async function stopTestApp(testApp: TestApp): Promise<void> {
  await testApp.app.close();
  await testApp.pm.close();
  await testApp.ai.close();
  rmSync(testApp.dir, { recursive: true, force: true });
}

async function startAndConfirmRecording(testApp: TestApp): Promise<void> {
  const response = await testApp.app.inject({ method: 'POST', url: '/api/v1/recording/start', headers: { authorization: `Bearer ${testApp.token}` } });
  expect(response.statusCode).toBe(202);
  await waitFor(() => testApp.pm.calls.some((call) => call.path === '/consumers/record'));
  testApp.pm.publish('evt.pm.consumer.running', { consumerId: FIRST_CONSUMER_ID, pgid: 1 });
  await waitFor(() => testApp.app.aiCountdown.snapshot().state === 'armed');
}

describe('ai countdown contract (openapi.yaml tag: ai — getAiCountdown, setAiInterval, generateNow)', () => {
  let testApp: TestApp;

  afterEach(async () => {
    await stopTestApp(testApp);
  });

  it('getAiCountdown: 200 parses zGetAiCountdownResponse when unavailable', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({ method: 'GET', url: '/api/v1/ai/countdown', headers: { authorization: `Bearer ${testApp.token}` } });
    expect(response.statusCode).toBe(200);
    const parsed = zGetAiCountdownResponse.parse(response.json());
    expect(parsed.state).toBe('unavailable');
  });

  it('setAiInterval: 409 parses zProblem when the countdown is not running', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({
      method: 'PUT',
      url: '/api/v1/ai/interval',
      headers: { authorization: `Bearer ${testApp.token}` },
      payload: { intervalMinutes: 15 },
    });
    expect(response.statusCode).toBe(409);
    expect(() => zProblem.parse(response.json())).not.toThrow();
  });

  it('generateNow: 409 parses zProblem when no recording is active', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({ method: 'POST', url: '/api/v1/ai/generate-now', headers: { authorization: `Bearer ${testApp.token}` } });
    expect(response.statusCode).toBe(409);
    expect(() => zProblem.parse(response.json())).not.toThrow();
  });

  it('getAiCountdown/setAiInterval/generateNow: 200/202 parse their contract shapes once armed', async () => {
    testApp = await startTestApp();
    await startAndConfirmRecording(testApp);

    const snapshot = await testApp.app.inject({ method: 'GET', url: '/api/v1/ai/countdown', headers: { authorization: `Bearer ${testApp.token}` } });
    expect(snapshot.statusCode).toBe(200);
    const parsedSnapshot = zGetAiCountdownResponse.parse(snapshot.json());
    expect(parsedSnapshot.state).toBe('armed');

    const interval = await testApp.app.inject({
      method: 'PUT',
      url: '/api/v1/ai/interval',
      headers: { authorization: `Bearer ${testApp.token}` },
      payload: { intervalMinutes: 30 },
    });
    expect(interval.statusCode).toBe(202);
    expect(() => zSetAiIntervalResponse.parse(interval.json())).not.toThrow();

    const generateNow = await testApp.app.inject({ method: 'POST', url: '/api/v1/ai/generate-now', headers: { authorization: `Bearer ${testApp.token}` } });
    expect(generateNow.statusCode).toBe(202);
    expect(() => zGenerateNowResponse.parse(generateNow.json())).not.toThrow();
  });
});
