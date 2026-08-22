import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { FastifyInstance } from 'fastify';
import { zCreateQuestionResponse, zDiscardQuestionResponse, zEditQuestionResponse, zListQuestionsResponse, zProblem } from '@eduscope/shared';
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
const BEARER = 'contract-test-internal-bearer-questions';
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
}

async function startTestApp(): Promise<TestApp> {
  const dir = mkdtempSync(join(tmpdir(), 'core-api-questions-contract-'));
  const pm = new FakePipelineManager({ bearerToken: BEARER });
  const pmBaseUrl = await pm.listen();
  const ai = new FakeAiServices({ bearerToken: BEARER });
  const aiBaseUrls = await ai.listen();
  const provisioningPath = writeProvisioning(dir);

  const config = loadConfig({
    NODE_ENV: 'test',
    CORE_API_DB_PATH: join(dir, 'core.db'),
    CORE_API_JWT_SECRET: 'questions-contract-secret',
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

async function startAndConfirmRecording(testApp: TestApp): Promise<string> {
  const response = await testApp.app.inject({ method: 'POST', url: '/api/v1/recording/start', headers: { authorization: `Bearer ${testApp.token}` } });
  expect(response.statusCode).toBe(202);
  await waitFor(() => testApp.pm.calls.some((call) => call.path === '/consumers/record'));
  testApp.pm.publish('evt.pm.consumer.running', { consumerId: FIRST_CONSUMER_ID, pgid: 1 });
  await waitFor(() => testApp.app.aiCountdown.snapshot().state === 'armed');
  return testApp.app.db.select().from(lectureSessions).all()[0]!.id;
}

function createBody(prompt = 'What is 2+2?'): Record<string, unknown> {
  return {
    prompt,
    options: [
      { text: '3', isCorrect: false },
      { text: '4', isCorrect: true },
    ],
  };
}

describe('questions contract (openapi.yaml tag: ai — listQuestions, createQuestion, editQuestion, discardQuestion)', () => {
  let testApp: TestApp;

  afterEach(async () => {
    await delay(50);
    await stopTestApp(testApp);
  });

  it('createQuestion: 409 parses zProblem when no recording is active', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({ method: 'POST', url: '/api/v1/ai/questions', headers: { authorization: `Bearer ${testApp.token}` }, payload: createBody() });
    expect(response.statusCode).toBe(409);
    expect(() => zProblem.parse(response.json())).not.toThrow();
  });

  it('createQuestion: 422 parses zProblem for an invalid options payload', async () => {
    testApp = await startTestApp();
    await startAndConfirmRecording(testApp);
    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/ai/questions',
      headers: { authorization: `Bearer ${testApp.token}` },
      payload: { prompt: 'Bad', options: [{ text: 'a', isCorrect: true }, { text: 'b', isCorrect: true }] },
    });
    expect(response.statusCode).toBe(422);
    expect(() => zProblem.parse(response.json())).not.toThrow();
  });

  it('listQuestions/createQuestion/editQuestion/discardQuestion: 200/202 parse their contract shapes', async () => {
    testApp = await startTestApp();
    const sessionId = await startAndConfirmRecording(testApp);

    const create = await testApp.app.inject({ method: 'POST', url: '/api/v1/ai/questions', headers: { authorization: `Bearer ${testApp.token}` }, payload: createBody() });
    expect(create.statusCode).toBe(202);
    expect(() => zCreateQuestionResponse.parse(create.json())).not.toThrow();

    const list = await testApp.app.inject({ method: 'GET', url: `/api/v1/ai/questions?sessionId=${encodeURIComponent(sessionId)}`, headers: { authorization: `Bearer ${testApp.token}` } });
    expect(list.statusCode).toBe(200);
    const listParsed = zListQuestionsResponse.parse(list.json());
    expect(listParsed.items).toHaveLength(1);
    const questionId = listParsed.items[0]!.id;

    const edit = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/v1/ai/questions/${questionId}`,
      headers: { authorization: `Bearer ${testApp.token}` },
      payload: { prompt: 'Edited?' },
    });
    expect(edit.statusCode).toBe(202);
    expect(() => zEditQuestionResponse.parse(edit.json())).not.toThrow();

    const discard = await testApp.app.inject({ method: 'POST', url: `/api/v1/ai/questions/${questionId}/discard`, headers: { authorization: `Bearer ${testApp.token}` } });
    expect(discard.statusCode).toBe(202);
    expect(() => zDiscardQuestionResponse.parse(discard.json())).not.toThrow();
  });

  it('editQuestion: 404 parses zProblem for an unknown question id', async () => {
    testApp = await startTestApp();
    await startAndConfirmRecording(testApp);
    const response = await testApp.app.inject({
      method: 'PATCH',
      url: '/api/v1/ai/questions/01UNKNOWNQUESTIONID000000',
      headers: { authorization: `Bearer ${testApp.token}` },
      payload: { prompt: 'x' },
    });
    expect(response.statusCode).toBe(404);
    expect(() => zProblem.parse(response.json())).not.toThrow();
  });

  it('discardQuestion: 409 parses zProblem for an already-discarded question', async () => {
    testApp = await startTestApp();
    await startAndConfirmRecording(testApp);
    const create = await testApp.app.inject({ method: 'POST', url: '/api/v1/ai/questions', headers: { authorization: `Bearer ${testApp.token}` }, payload: createBody() });
    expect(create.statusCode).toBe(202);
    const sessionId = testApp.app.db.select().from(lectureSessions).all()[0]!.id;
    const list = zListQuestionsResponse.parse(
      (await testApp.app.inject({ method: 'GET', url: `/api/v1/ai/questions?sessionId=${sessionId}`, headers: { authorization: `Bearer ${testApp.token}` } })).json(),
    );
    const questionId = list.items[0]!.id;

    const first = await testApp.app.inject({ method: 'POST', url: `/api/v1/ai/questions/${questionId}/discard`, headers: { authorization: `Bearer ${testApp.token}` } });
    expect(first.statusCode).toBe(202);
    const second = await testApp.app.inject({ method: 'POST', url: `/api/v1/ai/questions/${questionId}/discard`, headers: { authorization: `Bearer ${testApp.token}` } });
    expect(second.statusCode).toBe(409);
    expect(() => zProblem.parse(second.json())).not.toThrow();
  });
});
