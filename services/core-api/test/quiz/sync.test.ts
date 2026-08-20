import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { FastifyInstance } from 'fastify';
import type { QuizSessionPayload } from '@eduscope/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { answerProjections, lectureSessions, questionOptions, questionPublications, questions, quizSessionProjections, storageVolumes, users } from '../../src/db/schema.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { FakeAiServices } from '../fakes/ai-services.js';
import { FakeClock } from '../fakes/clock.js';
import { FakePipelineManager } from '../fakes/pipeline-manager.js';
import { FakeQuizService } from '../fakes/quiz-service.js';

const NOW = new Date('2026-08-20T08:00:00.000Z');
const BEARER = 'quiz-sync-test-internal-bearer';
const QUIZ_BEARER = 'quiz-sync-test-device-bearer';
const DEVICE_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV'; // zUlid-shaped — `sync.hello`'s deviceId is contract-typed as a ULID
const FIRST_CONSUMER_ID = 'record:00000001';

function fullProvisioning(): Record<string, unknown> {
  return {
    deviceId: DEVICE_ID,
    serialNumber: 'SN-1',
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
  };
}

function writeProvisioning(dir: string, overrides: Record<string, unknown> = {}): string {
  const path = join(dir, 'provisioning.json');
  writeFileSync(path, JSON.stringify({ ...fullProvisioning(), ...overrides }));
  return path;
}

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: condition not met in time');
    await delay(5);
  }
}

interface TestContext {
  dir: string;
  app: FastifyInstance;
  clock: FakeClock;
  pm: FakePipelineManager;
  ai: FakeAiServices;
  quiz: FakeQuizService;
  quizBaseUrl: string;
  ownerToken: string;
  sessionEvents: QuizSessionPayload[];
}

async function loginAs(app: FastifyInstance, username: string, password: string): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password, client: 'panel' } });
  return (response.json() as { tokens: { accessToken: string } }).tokens.accessToken;
}

async function createContext(options: { dbPath?: string; provisioningOverrides?: Record<string, unknown> } = {}): Promise<TestContext> {
  const dir = mkdtempSync(join(tmpdir(), 'core-api-quiz-sync-'));
  const pm = new FakePipelineManager({ bearerToken: BEARER });
  const pmBaseUrl = await pm.listen();
  const ai = new FakeAiServices({ bearerToken: BEARER });
  const aiBaseUrls = await ai.listen();
  const quiz = new FakeQuizService({ bearerToken: QUIZ_BEARER });
  const quizBaseUrl = await quiz.listen();
  const provisioningPath = writeProvisioning(dir, options.provisioningOverrides);

  const config = loadConfig({
    NODE_ENV: 'test',
    CORE_API_DB_PATH: options.dbPath ?? join(dir, 'core.db'),
    CORE_API_JWT_SECRET: 'quiz-sync-test-secret',
    CORE_API_PROVISIONING_PATH: provisioningPath,
    CORE_API_RECORDINGS_ROOT: join(dir, 'recordings'),
    CORE_API_RUNTIME_DIR: join(dir, 'runtime'),
    CORE_API_PM_BASE_URL: pmBaseUrl,
    CORE_API_INTERNAL_BEARER: BEARER,
  });

  const clock = new FakeClock(NOW);
  const ids = new UlidGenerator();
  const app = await buildApp({ config, clock, ids, aiBaseUrls, quizServiceBaseUrl: quizBaseUrl, quizDeviceBearer: QUIZ_BEARER });
  await app.lifecycle.start();
  await waitFor(() => pm.openConnectionCount === 1);

  const sessionEvents: QuizSessionPayload[] = [];
  app.bus.subscribe('quiz.session', (payload) => sessionEvents.push(payload));

  let ownerId = app.db.select({ id: users.id }).from(users).where(eq(users.username, 'owner')).get()?.id;
  if (!ownerId) {
    ownerId = ids.next(NOW);
    app.db
      .insert(users)
      .values({
        id: ownerId,
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
  }

  const ownerToken = await loginAs(app, 'owner', 'Password1');
  return { dir, app, clock, pm, ai, quiz, quizBaseUrl, ownerToken, sessionEvents };
}

async function destroyContext(ctx: TestContext, keepDir = false): Promise<void> {
  await ctx.app.close();
  await ctx.pm.close();
  await ctx.ai.close();
  await ctx.quiz.close();
  if (!keepDir) rmSync(ctx.dir, { recursive: true, force: true });
}

function currentSession(ctx: TestContext): typeof lectureSessions.$inferSelect {
  return ctx.app.db.select().from(lectureSessions).all()[0]!;
}

async function startAndConfirm(ctx: TestContext): Promise<string> {
  const response = await ctx.app.inject({ method: 'POST', url: '/api/v1/recording/start', headers: { authorization: `Bearer ${ctx.ownerToken}` } });
  expect(response.statusCode).toBe(202);
  await waitFor(() => ctx.pm.calls.some((call) => call.path === '/consumers/record'));
  ctx.pm.publish('evt.pm.consumer.running', { consumerId: FIRST_CONSUMER_ID, pgid: 1 });
  await waitFor(() => currentSession(ctx).state === 'recording');
  return currentSession(ctx).id;
}

async function openQuizSessionId(ctx: TestContext, lectureSessionId: string): Promise<string> {
  await waitFor(() => ctx.app.db.select().from(quizSessionProjections).where(eq(quizSessionProjections.lectureSessionId, lectureSessionId)).get()?.state === 'open');
  return ctx.app.db.select().from(quizSessionProjections).where(eq(quizSessionProjections.lectureSessionId, lectureSessionId)).get()!.id;
}

async function createOpenPublication(ctx: TestContext, prompt = 'What is 2+2?'): Promise<{ publicationId: string; optionAId: string }> {
  const create = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/ai/questions',
    headers: { authorization: `Bearer ${ctx.ownerToken}` },
    payload: { prompt, options: [{ text: '3', isCorrect: false }, { text: '4', isCorrect: true }] },
  });
  expect(create.statusCode).toBe(202);
  const question = ctx.app.db.select().from(questions).where(eq(questions.prompt, prompt)).get()!;
  const options = ctx.app.db.select().from(questionOptions).where(eq(questionOptions.questionId, question.id)).orderBy(questionOptions.position).all();

  const send = await ctx.app.inject({ method: 'POST', url: `/api/v1/ai/questions/${question.id}/send-to-projector`, headers: { authorization: `Bearer ${ctx.ownerToken}` } });
  expect(send.statusCode).toBe(202);
  await waitFor(() => ctx.app.db.select().from(questionPublications).where(eq(questionPublications.questionId, question.id)).get()?.state === 'open');
  return { publicationId: ctx.app.db.select().from(questionPublications).where(eq(questionPublications.questionId, question.id)).get()!.id, optionAId: options[0]!.id };
}

describe('Device-side quiz-sync client (events.md §4, machine 4d)', () => {
  let ctx: TestContext;

  afterEach(async () => {
    await delay(50);
    await destroyContext(ctx);
  });

  it('opens exactly one WS connection once the quiz session is open, authenticated with the deviceAuth bearer and contract header, and sends sync.hello first', async () => {
    ctx = await createContext();
    const sessionId = await startAndConfirm(ctx);
    const quizSessionId = await openQuizSessionId(ctx, sessionId);

    await waitFor(() => ctx.quiz.wsConnections.length === 1);
    const connection = ctx.quiz.latestWsConnection!;
    expect(connection.authorization).toBe(`Bearer ${QUIZ_BEARER}`);
    expect(connection.contractVersion).toBe('1.0');

    await waitFor(() => connection.receivedFrames.length > 0);
    const hello = connection.receivedFrames[0] as { type: string; deviceId: string; quizSessionId: string; answerWatermark: number };
    expect(hello.type).toBe('sync.hello');
    expect(hello.deviceId).toBe(DEVICE_ID);
    expect(hello.quizSessionId).toBe(quizSessionId);
    expect(hello.answerWatermark).toBe(0);

    // one active stream — a second open publication (which does not itself reconnect) never opens a second socket
    await createOpenPublication(ctx);
    await delay(50);
    expect(ctx.quiz.wsConnections).toHaveLength(1);
  });

  it('sends sync.heartbeat every T-QUIZ-HEARTBEAT (5s)', async () => {
    ctx = await createContext();
    const sessionId = await startAndConfirm(ctx);
    await openQuizSessionId(ctx, sessionId);
    await waitFor(() => ctx.quiz.wsConnections.length === 1);
    const connection = ctx.quiz.latestWsConnection!;
    await waitFor(() => connection.receivedFrames.length === 1); // hello only, so far

    ctx.clock.advance(5_000);
    await waitFor(() => connection.receivedFrames.length === 2);
    expect((connection.receivedFrames[1] as { type: string }).type).toBe('sync.heartbeat');

    ctx.clock.advance(5_000);
    await waitFor(() => connection.receivedFrames.length === 3);
  });

  it('ingests a sync.answers batch (seq ordering, duplicate idempotency) and records sync activity', async () => {
    ctx = await createContext();
    const sessionId = await startAndConfirm(ctx);
    const quizSessionId = await openQuizSessionId(ctx, sessionId);
    const { publicationId, optionAId } = await createOpenPublication(ctx);
    await waitFor(() => ctx.quiz.wsConnections.length === 1);

    const answer = { seq: 1, answerId: ctx.app.ids.next(ctx.clock.now()), publicationId, studentIdNumber: 'S001', studentDisplayName: 'Alice', selectedOptionId: optionAId, isCorrect: false, responseTimeMs: 1000, submittedAt: ctx.clock.now().toISOString() };
    ctx.quiz.sendToLatestConnection({ type: 'sync.answers', quizSessionId, answers: [answer] });
    await waitFor(() => ctx.app.db.select().from(answerProjections).where(eq(answerProjections.publicationId, publicationId)).all().length === 1);
    expect(ctx.app.db.select().from(quizSessionProjections).where(eq(quizSessionProjections.id, quizSessionId)).get()!.lastAnswerSeq).toBe(1);

    // duplicate replay (same seq/answerId) — idempotent, no second row, no seq regression.
    ctx.quiz.sendToLatestConnection({ type: 'sync.answers', quizSessionId, answers: [answer] });
    await delay(50);
    expect(ctx.app.db.select().from(answerProjections).where(eq(answerProjections.publicationId, publicationId)).all()).toHaveLength(1);
    expect(ctx.app.db.select().from(quizSessionProjections).where(eq(quizSessionProjections.id, quizSessionId)).get()!.lastAnswerSeq).toBe(1);
  });

  it('ingests sync.participants batches into the joined count', async () => {
    ctx = await createContext();
    const sessionId = await startAndConfirm(ctx);
    const quizSessionId = await openQuizSessionId(ctx, sessionId);
    await waitFor(() => ctx.quiz.wsConnections.length === 1);

    ctx.quiz.sendToLatestConnection({ type: 'sync.participants', quizSessionId, joinedCount: 7, onlineCount: 5 });
    await waitFor(() => {
      const response = ctx.sessionEvents.at(-1);
      return response?.joinedCount === 7;
    });
  });

  it('wrong-session rejection: a frame naming a different quizSessionId is dropped, not applied', async () => {
    ctx = await createContext();
    const sessionId = await startAndConfirm(ctx);
    const quizSessionId = await openQuizSessionId(ctx, sessionId);
    const { publicationId, optionAId } = await createOpenPublication(ctx);
    await waitFor(() => ctx.quiz.wsConnections.length === 1);
    void quizSessionId;

    const answer = { seq: 1, answerId: ctx.app.ids.next(ctx.clock.now()), publicationId, studentIdNumber: 'S001', studentDisplayName: 'Alice', selectedOptionId: optionAId, isCorrect: true, responseTimeMs: 500, submittedAt: ctx.clock.now().toISOString() };
    ctx.quiz.sendToLatestConnection({ type: 'sync.answers', quizSessionId: '01BX5ZZKBKACTAV9WEVGEMMVRZ', answers: [answer] }); // zUlid-shaped but genuinely a different session — exercises the explicit scope check, not zod rejection
    await delay(80);
    expect(ctx.app.db.select().from(answerProjections).where(eq(answerProjections.publicationId, publicationId)).all()).toHaveLength(0);
  });

  it('reconnects with backoff after an ungraceful drop and resends sync.hello', async () => {
    ctx = await createContext();
    const sessionId = await startAndConfirm(ctx);
    await openQuizSessionId(ctx, sessionId);
    await waitFor(() => ctx.quiz.wsConnections.length === 1);

    ctx.quiz.dropLatestConnection();
    await delay(50);
    expect(ctx.quiz.wsConnections).toHaveLength(1); // no immediate reconnect before the first backoff step elapses

    ctx.clock.advance(500); // T-WS-RECONNECT's first step
    await waitFor(() => ctx.quiz.wsConnections.length === 2);
    const second = ctx.quiz.latestWsConnection!;
    await waitFor(() => second.receivedFrames.length > 0);
    expect((second.receivedFrames[0] as { type: string }).type).toBe('sync.hello');
  });

  it('restarts from the persisted watermark: after a service restart, the fresh sync.hello carries the last ingested seq', async () => {
    ctx = await createContext();
    const sessionId = await startAndConfirm(ctx);
    const quizSessionId = await openQuizSessionId(ctx, sessionId);
    const { publicationId, optionAId } = await createOpenPublication(ctx);
    await waitFor(() => ctx.quiz.wsConnections.length === 1);

    const answer = { seq: 5, answerId: ctx.app.ids.next(ctx.clock.now()), publicationId, studentIdNumber: 'S001', studentDisplayName: 'Alice', selectedOptionId: optionAId, isCorrect: true, responseTimeMs: 700, submittedAt: ctx.clock.now().toISOString() };
    ctx.quiz.sendToLatestConnection({ type: 'sync.answers', quizSessionId, answers: [answer] });
    await waitFor(() => ctx.app.db.select().from(quizSessionProjections).where(eq(quizSessionProjections.id, quizSessionId)).get()!.lastAnswerSeq === 5);

    const dbPath = ctx.app.config.dbPath;
    await ctx.app.close(); // release the sqlite handle before the restarted instance reopens it (KEEP-style pattern, recording/lifecycle.test.ts)

    const restartConfig = loadConfig({
      NODE_ENV: 'test',
      CORE_API_DB_PATH: dbPath,
      CORE_API_JWT_SECRET: 'quiz-sync-test-secret',
      CORE_API_PROVISIONING_PATH: join(ctx.dir, 'provisioning.json'),
      CORE_API_RECORDINGS_ROOT: join(ctx.dir, 'recordings'),
      CORE_API_RUNTIME_DIR: join(ctx.dir, 'runtime'),
      CORE_API_PM_BASE_URL: 'http://127.0.0.1:1', // unreachable on purpose — restart persistence must not depend on PM being up
      CORE_API_INTERNAL_BEARER: BEARER,
    });
    const restartedClock = new FakeClock(NOW);
    const restarted = await buildApp({ config: restartConfig, clock: restartedClock, ids: new UlidGenerator(), quizServiceBaseUrl: ctx.quizBaseUrl, quizDeviceBearer: QUIZ_BEARER });
    await restarted.lifecycle.start();
    try {
      await waitFor(() => ctx.quiz.wsConnections.length === 2);
      const afterRestart = ctx.quiz.latestWsConnection!;
      await waitFor(() => afterRestart.receivedFrames.length > 0);
      const hello = afterRestart.receivedFrames[0] as { type: string; answerWatermark: number };
      expect(hello.type).toBe('sync.hello');
      expect(hello.answerWatermark).toBe(5);
    } finally {
      await restarted.close();
    }
  });
});
