import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { FastifyInstance } from 'fastify';
import type { AiSetPayload } from '@eduscope/shared';
import { zGetQuestionSetResponse, zListQuestionSetsResponse, zProblem } from '@eduscope/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { lectureSessions, storageVolumes, users } from '../../src/db/schema.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { FakeAiServices } from '../fakes/ai-services.js';
import { FakeClock } from '../fakes/clock.js';
import { FakePipelineManager } from '../fakes/pipeline-manager.js';

const NOW = new Date('2026-08-20T00:00:00.000Z');
const BEARER = 'contract-test-internal-bearer-question-sets';
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

async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
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
  setEvents: AiSetPayload[];
}

async function startTestApp(): Promise<TestApp> {
  const dir = mkdtempSync(join(tmpdir(), 'core-api-question-sets-contract-'));
  const pm = new FakePipelineManager({ bearerToken: BEARER });
  const pmBaseUrl = await pm.listen();
  const ai = new FakeAiServices({ bearerToken: BEARER });
  const aiBaseUrls = await ai.listen();
  const provisioningPath = writeProvisioning(dir);

  const config = loadConfig({
    NODE_ENV: 'test',
    CORE_API_DB_PATH: join(dir, 'core.db'),
    CORE_API_JWT_SECRET: 'question-sets-contract-secret',
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

  const setEvents: AiSetPayload[] = [];
  app.bus.subscribe('ai.set', (payload) => setEvents.push(payload));

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

  return { app, dir, pm, ai, token, setEvents };
}

async function stopTestApp(testApp: TestApp): Promise<void> {
  await testApp.app.close();
  await testApp.pm.close();
  await testApp.ai.close();
  rmSync(testApp.dir, { recursive: true, force: true });
}

async function startAndConfirmRecording(testApp: TestApp): Promise<string> {
  const response = await testApp.app.inject({ method: 'POST', url: '/api/v1/recording/start', headers: { authorization: `Bearer ${testApp.token}` } });
  expect(response.statusCode).toBe(202);
  await waitFor(() => testApp.pm.calls.some((call) => call.path === '/consumers/record'));
  testApp.pm.publish('evt.pm.consumer.running', { consumerId: FIRST_CONSUMER_ID, pgid: 1 });
  await waitFor(() => testApp.app.aiCountdown.snapshot().state === 'armed');
  return testApp.app.db.select().from(lectureSessions).all()[0]!.id;
}

describe('question-sets contract (openapi.yaml tag: ai — listQuestionSets, getQuestionSet)', () => {
  let testApp: TestApp;

  afterEach(async () => {
    await delay(50);
    await stopTestApp(testApp);
  });

  it('listQuestionSets: 200 parses zListQuestionSetsResponse (empty before any generation)', async () => {
    testApp = await startTestApp();
    const sessionId = await startAndConfirmRecording(testApp);

    const response = await testApp.app.inject({
      method: 'GET',
      url: `/api/v1/ai/question-sets?sessionId=${encodeURIComponent(sessionId)}`,
      headers: { authorization: `Bearer ${testApp.token}` },
    });
    expect(response.statusCode).toBe(200);
    const parsed = zListQuestionSetsResponse.parse(response.json());
    expect(parsed.items).toEqual([]);
  });

  it('listQuestionSets/getQuestionSet: 200 parse their contract shapes once a set is ready', async () => {
    testApp = await startTestApp();
    const sessionId = await startAndConfirmRecording(testApp);

    testApp.ai.queueGenerateBehaviors([
      {
        kind: 'response',
        body: {
          questionSetId: 'x',
          promptVersion: 'mcq/v1',
          modelId: 'llama',
          requested: 3,
          returned: 1,
          droppedInvalid: 0,
          questions: [{ prompt: 'What is 2+2?', options: [{ text: '3', isCorrect: false }, { text: '4', isCorrect: true }] }],
        },
      },
    ]);
    const generateNow = await testApp.app.inject({ method: 'POST', url: '/api/v1/ai/generate-now', headers: { authorization: `Bearer ${testApp.token}` } });
    expect(generateNow.statusCode).toBe(202);
    await waitFor(() => testApp.setEvents.some((event) => event.state === 'ready'));
    const setId = testApp.setEvents.find((event) => event.state === 'ready')!.setId;

    const listResponse = await testApp.app.inject({
      method: 'GET',
      url: `/api/v1/ai/question-sets?sessionId=${encodeURIComponent(sessionId)}`,
      headers: { authorization: `Bearer ${testApp.token}` },
    });
    expect(listResponse.statusCode).toBe(200);
    const listParsed = zListQuestionSetsResponse.parse(listResponse.json());
    expect(listParsed.items).toHaveLength(1);
    expect(listParsed.items[0]!.state).toBe('ready');

    const detailResponse = await testApp.app.inject({ method: 'GET', url: `/api/v1/ai/question-sets/${setId}`, headers: { authorization: `Bearer ${testApp.token}` } });
    expect(detailResponse.statusCode).toBe(200);
    const detailParsed = zGetQuestionSetResponse.parse(detailResponse.json());
    expect(detailParsed.questions).toHaveLength(1);
    expect(detailParsed.questions[0]!.options).toHaveLength(2);
  });

  it('getQuestionSet: 404 parses zProblem for an unknown set id', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({ method: 'GET', url: '/api/v1/ai/question-sets/01UNKNOWNQUESTIONSETID0000', headers: { authorization: `Bearer ${testApp.token}` } });
    expect(response.statusCode).toBe(404);
    expect(() => zProblem.parse(response.json())).not.toThrow();
  });
});
