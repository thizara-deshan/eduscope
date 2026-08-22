import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { FastifyInstance } from 'fastify';
import { zClosePublicationResponse, zListPublicationsResponse, zProblem, zSendToProjectorResponse, zSetProjectorResponse } from '@eduscope/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { lectureSessions, questions, quizSessionProjections, storageVolumes, users } from '../../src/db/schema.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { FakeAiServices } from '../fakes/ai-services.js';
import { FakeClock } from '../fakes/clock.js';
import { FakePipelineManager } from '../fakes/pipeline-manager.js';
import { FakeQuizService } from '../fakes/quiz-service.js';

const NOW = new Date('2026-08-20T00:00:00.000Z');
const BEARER = 'contract-test-internal-bearer-publications';
const QUIZ_BEARER = 'contract-test-device-bearer-publications';
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
  quiz: FakeQuizService;
  token: string;
}

async function startTestApp(): Promise<TestApp> {
  const dir = mkdtempSync(join(tmpdir(), 'core-api-publications-contract-'));
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
    CORE_API_JWT_SECRET: 'publications-contract-secret',
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

async function startAndConfirmRecording(testApp: TestApp): Promise<string> {
  const response = await testApp.app.inject({ method: 'POST', url: '/api/v1/recording/start', headers: { authorization: `Bearer ${testApp.token}` } });
  expect(response.statusCode).toBe(202);
  await waitFor(() => testApp.pm.calls.some((call) => call.path === '/consumers/record'));
  testApp.pm.publish('evt.pm.consumer.running', { consumerId: FIRST_CONSUMER_ID, pgid: 1 });
  await waitFor(() => testApp.app.db.select().from(lectureSessions).all()[0]?.state === 'recording');
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

async function createDraftQuestion(testApp: TestApp, prompt = 'What is 2+2?'): Promise<string> {
  const response = await testApp.app.inject({ method: 'POST', url: '/api/v1/ai/questions', headers: { authorization: `Bearer ${testApp.token}` }, payload: createBody(prompt) });
  expect(response.statusCode).toBe(202);
  return testApp.app.db.select().from(questions).where(eq(questions.prompt, prompt)).all().at(-1)!.id;
}

/** Waits for B-33's real Z-01/Z-02 (mint session, fired automatically off `recording.state{recording}`) to reach `open` against the fixture quiz-service. */
async function openQuizSession(testApp: TestApp, lectureSessionId: string): Promise<void> {
  await waitFor(() => testApp.app.db.select().from(quizSessionProjections).where(eq(quizSessionProjections.lectureSessionId, lectureSessionId)).get()?.state === 'open');
}

describe('publications contract (openapi.yaml tag: ai — sendToProjector, listPublications, closePublication, setProjector)', () => {
  let testApp: TestApp;

  afterEach(async () => {
    await delay(50);
    await stopTestApp(testApp);
  });

  it('sendToProjector: 404 parses zProblem for an unknown question id', async () => {
    testApp = await startTestApp();
    await startAndConfirmRecording(testApp);
    const response = await testApp.app.inject({ method: 'POST', url: '/api/v1/ai/questions/01UNKNOWNQUESTIONID000000/send-to-projector', headers: { authorization: `Bearer ${testApp.token}` } });
    expect(response.statusCode).toBe(404);
    expect(() => zProblem.parse(response.json())).not.toThrow();
  });

  it('sendToProjector: 409 quiz.unavailable parses zProblem when no quiz session is open', async () => {
    testApp = await startTestApp();
    testApp.quiz.setOffline(true); // guarantees Z-01/Z-02 never reaches `open`, deterministically
    await startAndConfirmRecording(testApp);
    const questionId = await createDraftQuestion(testApp);
    const response = await testApp.app.inject({ method: 'POST', url: `/api/v1/ai/questions/${questionId}/send-to-projector`, headers: { authorization: `Bearer ${testApp.token}` } });
    expect(response.statusCode).toBe(409);
    expect(() => zProblem.parse(response.json())).not.toThrow();
  });

  it('sendToProjector/listPublications/closePublication/setProjector: 200/202 parse their contract shapes', async () => {
    testApp = await startTestApp();
    const sessionId = await startAndConfirmRecording(testApp);
    await openQuizSession(testApp, sessionId);
    const questionId = await createDraftQuestion(testApp);

    const send = await testApp.app.inject({ method: 'POST', url: `/api/v1/ai/questions/${questionId}/send-to-projector`, headers: { authorization: `Bearer ${testApp.token}` } });
    expect(send.statusCode).toBe(202);
    expect(() => zSendToProjectorResponse.parse(send.json())).not.toThrow();
    await waitFor(() => testApp.app.db.select().from(questions).where(eq(questions.id, questionId)).get()!.state === 'sent');

    const list = await testApp.app.inject({ method: 'GET', url: `/api/v1/ai/publications?sessionId=${encodeURIComponent(sessionId)}`, headers: { authorization: `Bearer ${testApp.token}` } });
    expect(list.statusCode).toBe(200);
    const listParsed = zListPublicationsResponse.parse(list.json());
    expect(listParsed.items).toHaveLength(1);
    const publicationId = listParsed.items[0]!.id;

    const project = await testApp.app.inject({ method: 'PUT', url: '/api/v1/ai/projector', headers: { authorization: `Bearer ${testApp.token}` }, payload: { publicationId: null } });
    expect(project.statusCode).toBe(202);
    expect(() => zSetProjectorResponse.parse(project.json())).not.toThrow();

    const close = await testApp.app.inject({ method: 'POST', url: `/api/v1/ai/publications/${publicationId}/close`, headers: { authorization: `Bearer ${testApp.token}` } });
    expect(close.statusCode).toBe(202);
    expect(() => zClosePublicationResponse.parse(close.json())).not.toThrow();
  });

  it('closePublication: 404 parses zProblem for an unknown publication id', async () => {
    testApp = await startTestApp();
    await startAndConfirmRecording(testApp);
    const response = await testApp.app.inject({ method: 'POST', url: '/api/v1/ai/publications/01UNKNOWNPUBLICATIONID000/close', headers: { authorization: `Bearer ${testApp.token}` } });
    expect(response.statusCode).toBe(404);
    expect(() => zProblem.parse(response.json())).not.toThrow();
  });
});
