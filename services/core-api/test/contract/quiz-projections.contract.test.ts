import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { FastifyInstance } from 'fastify';
import { zGetLeaderboardResponse, zGetQuizSessionResponse, zListPublicationResponsesResponse, zProblem } from '@eduscope/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { lectureSessions, questionOptions, questionPublications, questions, quizSessionProjections, storageVolumes, users } from '../../src/db/schema.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { ingestAnswers } from '../../src/modules/quiz/responses.js';
import { FakeAiServices } from '../fakes/ai-services.js';
import { FakeClock } from '../fakes/clock.js';
import { FakePipelineManager } from '../fakes/pipeline-manager.js';
import { FakeQuizService } from '../fakes/quiz-service.js';

const NOW = new Date('2026-08-20T00:00:00.000Z');
const BEARER = 'contract-test-internal-bearer-quiz-projections';
const QUIZ_BEARER = 'contract-test-device-bearer-quiz-projections';
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
  const dir = mkdtempSync(join(tmpdir(), 'core-api-quiz-projections-contract-'));
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
    CORE_API_JWT_SECRET: 'quiz-projections-contract-secret',
    CORE_API_PROVISIONING_PATH: provisioningPath,
    CORE_API_RECORDINGS_ROOT: join(dir, 'recordings'),
    CORE_API_RUNTIME_DIR: join(dir, 'runtime'),
    CORE_API_PM_BASE_URL: pmBaseUrl,
    CORE_API_INTERNAL_BEARER: BEARER,
  });
  const ids = new UlidGenerator();
  const clock = new FakeClock(NOW);
  const app = await buildApp({ config, clock, ids, aiBaseUrls, quizServiceBaseUrl: quizBaseUrl, quizDeviceBearer: QUIZ_BEARER });
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

async function waitForOpenQuizSession(testApp: TestApp, lectureSessionId: string): Promise<string> {
  await waitFor(() => testApp.app.db.select().from(quizSessionProjections).where(eq(quizSessionProjections.lectureSessionId, lectureSessionId)).get()?.state === 'open');
  return testApp.app.db.select().from(quizSessionProjections).where(eq(quizSessionProjections.lectureSessionId, lectureSessionId)).get()!.id;
}

async function createOpenPublication(testApp: TestApp): Promise<{ publicationId: string; optionAId: string }> {
  const prompt = 'What is 2+2?';
  const create = await testApp.app.inject({
    method: 'POST',
    url: '/api/v1/ai/questions',
    headers: { authorization: `Bearer ${testApp.token}` },
    payload: { prompt, options: [{ text: '3', isCorrect: false }, { text: '4', isCorrect: true }] },
  });
  expect(create.statusCode).toBe(202);
  const question = testApp.app.db.select().from(questions).where(eq(questions.prompt, prompt)).get()!;
  const options = testApp.app.db.select().from(questionOptions).where(eq(questionOptions.questionId, question.id)).orderBy(questionOptions.position).all();

  const send = await testApp.app.inject({ method: 'POST', url: `/api/v1/ai/questions/${question.id}/send-to-projector`, headers: { authorization: `Bearer ${testApp.token}` } });
  expect(send.statusCode).toBe(202);
  await waitFor(() => testApp.app.db.select().from(questionPublications).where(eq(questionPublications.questionId, question.id)).get()?.state === 'open');
  const publication = testApp.app.db.select().from(questionPublications).where(eq(questionPublications.questionId, question.id)).get()!;
  return { publicationId: publication.id, optionAId: options[0]!.id };
}

describe('quiz projections contract (openapi.yaml tag: quiz — getQuizSession, listPublicationResponses, getLeaderboard)', () => {
  let testApp: TestApp;

  afterEach(async () => {
    await delay(50);
    await stopTestApp(testApp);
  });

  it('getQuizSession: 200 parses zGetQuizSessionResponse when absent (unconfigured/no active recording)', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({ method: 'GET', url: '/api/v1/quiz/session', headers: { authorization: `Bearer ${testApp.token}` } });
    expect(response.statusCode).toBe(200);
    const parsed = zGetQuizSessionResponse.parse(response.json());
    expect(parsed.state).toBe('absent');
  });

  it('listPublicationResponses: 404 parses zProblem for an unknown publication id', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({ method: 'GET', url: '/api/v1/quiz/publications/01UNKNOWNPUBLICATIONID000/responses', headers: { authorization: `Bearer ${testApp.token}` } });
    expect(response.statusCode).toBe(404);
    expect(() => zProblem.parse(response.json())).not.toThrow();
  });

  it('getQuizSession/listPublicationResponses/getLeaderboard: 200 parse their contract shapes once open with answers', async () => {
    testApp = await startTestApp();
    const sessionId = await startAndConfirmRecording(testApp);
    await waitForOpenQuizSession(testApp, sessionId);

    const sessionResponse = await testApp.app.inject({ method: 'GET', url: '/api/v1/quiz/session', headers: { authorization: `Bearer ${testApp.token}` } });
    expect(sessionResponse.statusCode).toBe(200);
    expect(() => zGetQuizSessionResponse.parse(sessionResponse.json())).not.toThrow();

    const { publicationId, optionAId } = await createOpenPublication(testApp);
    const quizSessionRow = testApp.app.db.select().from(quizSessionProjections).where(eq(quizSessionProjections.lectureSessionId, sessionId)).get()!;
    ingestAnswers({ db: testApp.app.db, clock: testApp.app.clock, bus: testApp.app.bus }, quizSessionRow.id, [
      { seq: 1, answerId: testApp.app.ids.next(NOW), publicationId, studentIdNumber: 'S001', studentDisplayName: 'Alice', selectedOptionId: optionAId, isCorrect: false, responseTimeMs: 1000, submittedAt: NOW.toISOString() },
    ]);

    const responsesResponse = await testApp.app.inject({ method: 'GET', url: `/api/v1/quiz/publications/${publicationId}/responses`, headers: { authorization: `Bearer ${testApp.token}` } });
    expect(responsesResponse.statusCode).toBe(200);
    expect(() => zListPublicationResponsesResponse.parse(responsesResponse.json())).not.toThrow();

    const leaderboardResponse = await testApp.app.inject({ method: 'GET', url: `/api/v1/quiz/leaderboard?sessionId=${encodeURIComponent(sessionId)}`, headers: { authorization: `Bearer ${testApp.token}` } });
    expect(leaderboardResponse.statusCode).toBe(200);
    const leaderboard = zGetLeaderboardResponse.parse(leaderboardResponse.json());
    expect(leaderboard.entries).toHaveLength(1);
  });
});
