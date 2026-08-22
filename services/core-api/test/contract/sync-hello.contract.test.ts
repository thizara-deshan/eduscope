import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { FastifyInstance } from 'fastify';
import { zQuizSyncClientMessage } from '@eduscope/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { lectureSessions, quizSessionProjections, storageVolumes, users } from '../../src/db/schema.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { FakeAiServices } from '../fakes/ai-services.js';
import { FakeClock } from '../fakes/clock.js';
import { FakePipelineManager } from '../fakes/pipeline-manager.js';
import { FakeQuizService } from '../fakes/quiz-service.js';

const NOW = new Date('2026-08-20T00:00:00.000Z');
const BEARER = 'contract-test-internal-bearer-sync-hello';
const QUIZ_BEARER = 'contract-test-device-bearer-sync-hello';
const DEVICE_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const FIRST_CONSUMER_ID = 'record:00000001';

function writeProvisioning(dir: string): string {
  const path = join(dir, 'provisioning.json');
  writeFileSync(
    path,
    JSON.stringify({
      deviceId: DEVICE_ID,
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

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: condition not met in time');
    await delay(5);
  }
}

interface TestApp {
  app: FastifyInstance;
  dir: string;
  pm: FakePipelineManager;
  ai: FakeAiServices;
  quiz: FakeQuizService;
  token: string;
}

async function startTestApp(): Promise<TestApp> {
  const dir = mkdtempSync(join(tmpdir(), 'core-api-sync-hello-contract-'));
  const pm = new FakePipelineManager({ bearerToken: BEARER });
  const pmBaseUrl = await pm.listen();
  const ai = new FakeAiServices({ bearerToken: BEARER });
  const aiBaseUrls = await ai.listen();
  const quiz = new FakeQuizService({ bearerToken: QUIZ_BEARER });
  const quizBaseUrl = await quiz.listen();
  const provisioningPath = writeProvisioning(dir);

  const config = loadConfig({
    NODE_ENV: 'test',
    CORE_API_DB_PATH: join(dir, 'core.db'),
    CORE_API_JWT_SECRET: 'sync-hello-contract-secret',
    CORE_API_PROVISIONING_PATH: provisioningPath,
    CORE_API_RECORDINGS_ROOT: join(dir, 'recordings'),
    CORE_API_RUNTIME_DIR: join(dir, 'runtime'),
    CORE_API_PM_BASE_URL: pmBaseUrl,
    CORE_API_INTERNAL_BEARER: BEARER,
  });
  const ids = new UlidGenerator();
  const app = await buildApp({ config, clock: new FakeClock(NOW), ids, aiBaseUrls, quizServiceBaseUrl: quizBaseUrl, quizDeviceBearer: QUIZ_BEARER });
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

  return { app, dir, pm, ai, quiz, token };
}

async function stopTestApp(testApp: TestApp): Promise<void> {
  await testApp.app.close();
  await testApp.pm.close();
  await testApp.ai.close();
  await testApp.quiz.close();
  rmSync(testApp.dir, { recursive: true, force: true });
}

describe('sync.hello contract (events.md §4 — the only B-owned quiz-sync WS message)', () => {
  let testApp: TestApp;

  afterEach(async () => {
    await delay(50);
    await stopTestApp(testApp);
  });

  it('opens the WS stream with the deviceAuth bearer and x-eduscope-contract header, and its first frame is a contract-valid sync.hello', async () => {
    testApp = await startTestApp();

    const start = await testApp.app.inject({ method: 'POST', url: '/api/v1/recording/start', headers: { authorization: `Bearer ${testApp.token}` } });
    expect(start.statusCode).toBe(202);
    await waitFor(() => testApp.pm.calls.some((call) => call.path === '/consumers/record'));
    testApp.pm.publish('evt.pm.consumer.running', { consumerId: FIRST_CONSUMER_ID, pgid: 1 });
    await waitFor(() => testApp.app.db.select().from(lectureSessions).all()[0]?.state === 'recording');
    const lectureSessionId = testApp.app.db.select().from(lectureSessions).all()[0]!.id;
    await waitFor(() => testApp.app.db.select().from(quizSessionProjections).where(eq(quizSessionProjections.lectureSessionId, lectureSessionId)).get()?.state === 'open');
    const quizSessionId = testApp.app.db.select().from(quizSessionProjections).where(eq(quizSessionProjections.lectureSessionId, lectureSessionId)).get()!.id;

    await waitFor(() => testApp.quiz.wsConnections.length === 1);
    const connection = testApp.quiz.latestWsConnection!;
    expect(connection.authorization).toBe(`Bearer ${QUIZ_BEARER}`);
    expect(connection.contractVersion).toBe('1.0');

    await waitFor(() => connection.receivedFrames.length > 0);
    const parsed = zQuizSyncClientMessage.parse(connection.receivedFrames[0]);
    if (parsed.type !== 'sync.hello') throw new Error(`expected sync.hello, got ${parsed.type}`);
    expect(parsed.deviceId).toBe(DEVICE_ID);
    expect(parsed.quizSessionId).toBe(quizSessionId);
    expect(parsed.answerWatermark).toBe(0);
  });

  it('sync.heartbeat (the other B-owned client message) also parses as zQuizSyncClientMessage', async () => {
    testApp = await startTestApp();
    const start = await testApp.app.inject({ method: 'POST', url: '/api/v1/recording/start', headers: { authorization: `Bearer ${testApp.token}` } });
    expect(start.statusCode).toBe(202);
    await waitFor(() => testApp.pm.calls.some((call) => call.path === '/consumers/record'));
    testApp.pm.publish('evt.pm.consumer.running', { consumerId: FIRST_CONSUMER_ID, pgid: 1 });
    await waitFor(() => testApp.quiz.wsConnections.length === 1);
    const connection = testApp.quiz.latestWsConnection!;
    await waitFor(() => connection.receivedFrames.length === 1); // hello only, so far

    (testApp.app.clock as FakeClock).advance(5_000);
    await waitFor(() => connection.receivedFrames.length === 2);
    const parsed = zQuizSyncClientMessage.parse(connection.receivedFrames[1]);
    expect(parsed.type).toBe('sync.heartbeat');
  });
});
