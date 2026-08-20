import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { FastifyInstance } from 'fastify';
import type { AiQuestionPayload, AiSetPayload, QuizPublicationPayload } from '@eduscope/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { lectureSessions, questionOptions, questionPublications, questions, questionSets, quizSessionProjections, storageVolumes, users } from '../../src/db/schema.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { FakeAiServices } from '../fakes/ai-services.js';
import { FakeClock } from '../fakes/clock.js';
import { FakePipelineManager } from '../fakes/pipeline-manager.js';
import { FakeQuizService } from '../fakes/quiz-service.js';

const NOW = new Date('2026-08-20T08:00:00.000Z');
const BEARER = 'quiz-publication-test-internal-bearer';
const QUIZ_BEARER = 'quiz-publication-test-device-bearer';
const FIRST_CONSUMER_ID = 'record:00000001';

function fullProvisioning(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    deviceId: 'device-1',
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
    ...overrides,
  };
}

function writeProvisioning(dir: string): string {
  const path = join(dir, 'provisioning.json');
  writeFileSync(path, JSON.stringify(fullProvisioning()));
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
  ownerToken: string;
  ownerId: string;
  publicationEvents: QuizPublicationPayload[];
  questionEvents: AiQuestionPayload[];
  setEvents: AiSetPayload[];
}

async function loginAs(app: FastifyInstance, username: string, password: string): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password, client: 'panel' } });
  return (response.json() as { tokens: { accessToken: string } }).tokens.accessToken;
}

async function createContext(): Promise<TestContext> {
  const dir = mkdtempSync(join(tmpdir(), 'core-api-quiz-publication-'));
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
    CORE_API_JWT_SECRET: 'quiz-publication-test-secret',
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

  const publicationEvents: QuizPublicationPayload[] = [];
  app.bus.subscribe('quiz.publication', (payload) => publicationEvents.push(payload));
  const questionEvents: AiQuestionPayload[] = [];
  app.bus.subscribe('ai.question', (payload) => questionEvents.push(payload));
  const setEvents: AiSetPayload[] = [];
  app.bus.subscribe('ai.set', (payload) => setEvents.push(payload));

  const ownerId = ids.next(NOW);
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

  const ownerToken = await loginAs(app, 'owner', 'Password1');
  return { dir, app, clock, pm, ai, quiz, ownerToken, ownerId, publicationEvents, questionEvents, setEvents };
}

async function destroyContext(ctx: TestContext): Promise<void> {
  await ctx.app.close();
  await ctx.pm.close();
  await ctx.ai.close();
  await ctx.quiz.close();
  rmSync(ctx.dir, { recursive: true, force: true });
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

/** Waits for B-33's real Z-01/Z-02 (mint session, fired automatically off `recording.state{recording}`) to reach `open` against the fixture quiz-service, then returns the projection row id. */
async function openQuizSession(ctx: TestContext, lectureSessionId: string): Promise<string> {
  await waitFor(() => {
    const row = ctx.app.db.select().from(quizSessionProjections).where(eq(quizSessionProjections.lectureSessionId, lectureSessionId)).get();
    return row?.state === 'open';
  });
  return ctx.app.db.select().from(quizSessionProjections).where(eq(quizSessionProjections.lectureSessionId, lectureSessionId)).get()!.id;
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

async function createDraftQuestion(ctx: TestContext, prompt = 'What is 2+2?'): Promise<string> {
  const response = await ctx.app.inject({ method: 'POST', url: '/api/v1/ai/questions', headers: { authorization: `Bearer ${ctx.ownerToken}` }, payload: createBody(prompt) });
  expect(response.statusCode).toBe(202);
  const row = ctx.app.db.select().from(questions).where(eq(questions.prompt, prompt)).all().at(-1)!;
  return row.id;
}

async function sendToProjector(ctx: TestContext, questionId: string): Promise<{ statusCode: number; body: unknown }> {
  const response = await ctx.app.inject({ method: 'POST', url: `/api/v1/ai/questions/${questionId}/send-to-projector`, headers: { authorization: `Bearer ${ctx.ownerToken}` } });
  return { statusCode: response.statusCode, body: response.json() };
}

function publicationFor(ctx: TestContext, questionId: string): typeof questionPublications.$inferSelect {
  return ctx.app.db.select().from(questionPublications).where(eq(questionPublications.questionId, questionId)).get()!;
}

describe('Publication and projector orchestration (Q-30..Q-36, machine 2d)', () => {
  let ctx: TestContext;

  afterEach(async () => {
    await delay(50);
    await destroyContext(ctx);
  });

  it('Q-30/Q-31: creates a publishing row, publishes correctOptionId to quiz-service, then switches the projector only after the 201 ack', async () => {
    ctx = await createContext();
    const sessionId = await startAndConfirm(ctx);
    await openQuizSession(ctx, sessionId);
    const questionId = await createDraftQuestion(ctx);

    const { statusCode } = await sendToProjector(ctx, questionId);
    expect(statusCode).toBe(202);
    await waitFor(() => ctx.publicationEvents.some((event) => event.state === 'publishing'));

    await waitFor(() => ctx.quiz.calls.some((call) => call.path === '/device/v1/publications'));
    const publishCall = ctx.quiz.calls.find((call) => call.path === '/device/v1/publications')!;
    expect(publishCall.authorization).toBe(`Bearer ${QUIZ_BEARER}`);
    expect(publishCall.contractVersion).toBe('1.0');
    const question = ctx.app.db.select().from(questions).where(eq(questions.id, questionId)).get()!;
    const publishBody = publishCall.body as { correctOptionId: string; options: unknown[] };
    expect(publishBody.correctOptionId).toBe(question.correctOptionId);
    expect(publishBody.options).toHaveLength(2);

    await waitFor(() => ctx.pm.calls.some((call) => call.path === '/consumers/projector'));
    const projectorCall = ctx.pm.calls.find((call) => call.path === '/consumers/projector')!;
    const projectorBody = projectorCall.body as { mode: string; questionPayload: { correctOptionId?: string; joinUrl: string | null; joinCode: string | null } };
    expect(projectorBody.mode).toBe('question');
    expect(projectorBody.questionPayload.correctOptionId).toBeUndefined();
    expect(projectorBody.questionPayload.joinUrl).toMatch(/^https:\/\/quiz\.example\.edu\/j\//);
    expect(projectorBody.questionPayload.joinCode).toBe('AB12CD');

    // PM call happens only after the D ack: no projector call recorded before the quiz-service call resolved.
    const publishIndex = ctx.quiz.calls.findIndex((call) => call.path === '/device/v1/publications');
    const projectorIndex = ctx.pm.calls.findIndex((call) => call.path === '/consumers/projector');
    expect(publishIndex).toBeGreaterThanOrEqual(0);
    expect(projectorIndex).toBeGreaterThan(-1);

    await waitFor(() => publicationFor(ctx, questionId).state === 'open');
    const publication = publicationFor(ctx, questionId);
    expect(publication.isShowing).toBe(true);
    expect(publication.projectorState).toBe('showing');
    expect(publication.publishedAt).not.toBeNull();
    await waitFor(() => ctx.app.db.select().from(questions).where(eq(questions.id, questionId)).get()!.state === 'sent');
  });

  it('Q-31: sending a second question closes the previous open publication (closeReason=next-question) and enforces exactly one isShowing', async () => {
    ctx = await createContext();
    const sessionId = await startAndConfirm(ctx);
    await openQuizSession(ctx, sessionId);
    const firstId = await createDraftQuestion(ctx, 'First?');
    await sendToProjector(ctx, firstId);
    await waitFor(() => publicationFor(ctx, firstId).state === 'open');

    const secondId = await createDraftQuestion(ctx, 'Second?');
    await sendToProjector(ctx, secondId);
    await waitFor(() => publicationFor(ctx, secondId).state === 'open');

    const first = publicationFor(ctx, firstId);
    const second = publicationFor(ctx, secondId);
    expect(first.state).toBe('closed');
    expect(first.closeReason).toBe('next-question');
    expect(first.isShowing).toBe(false);
    expect(second.isShowing).toBe(true);

    const showingCount = ctx.app.db.select().from(questionPublications).where(eq(questionPublications.quizSessionId, second.quizSessionId)).all().filter((row) => row.isShowing).length;
    expect(showingCount).toBe(1);
  });

  it('Q-32: no ack within T-PUBLISH-ACK plus one retry fails the publication and the PM projector call never happens', async () => {
    ctx = await createContext();
    const sessionId = await startAndConfirm(ctx);
    await openQuizSession(ctx, sessionId);
    const questionId = await createDraftQuestion(ctx);
    ctx.quiz.setOffline(true);

    await sendToProjector(ctx, questionId);
    await waitFor(() => ctx.quiz.calls.every((call) => call.path !== '/device/v1/publications')); // offline: fetch fails immediately, no recorded publish call
    ctx.clock.advance(5_000); // first attempt's T-PUBLISH-ACK
    await delay(20);
    ctx.clock.advance(2_000); // retry backoff
    await delay(20);
    ctx.clock.advance(5_000); // second attempt's T-PUBLISH-ACK

    await waitFor(() => publicationFor(ctx, questionId).state === 'failed');
    expect(ctx.pm.calls.some((call) => call.path === '/consumers/projector')).toBe(false);
    const question = ctx.app.db.select().from(questions).where(eq(questions.id, questionId)).get()!;
    expect(question.state).toBe('draft');
  });

  it('Q-35: closePublication carries the authoritative closedAt and is idempotent on a second call', async () => {
    ctx = await createContext();
    const sessionId = await startAndConfirm(ctx);
    await openQuizSession(ctx, sessionId);
    const questionId = await createDraftQuestion(ctx);
    await sendToProjector(ctx, questionId);
    await waitFor(() => publicationFor(ctx, questionId).state === 'open');
    const publicationId = publicationFor(ctx, questionId).id;

    const closeResponse = await ctx.app.inject({ method: 'POST', url: `/api/v1/ai/publications/${publicationId}/close`, headers: { authorization: `Bearer ${ctx.ownerToken}` } });
    expect(closeResponse.statusCode).toBe(202);
    await waitFor(() => publicationFor(ctx, questionId).state === 'closed');
    const closed = publicationFor(ctx, questionId);
    expect(closed.closeReason).toBe('lecturer-closed');
    expect(closed.closedAt).not.toBeNull();

    await waitFor(() => ctx.quiz.calls.some((call) => call.path === `/device/v1/publications/${publicationId}/close`));
    const remoteClose = ctx.quiz.calls.find((call) => call.path === `/device/v1/publications/${publicationId}/close`)!;
    expect((remoteClose.body as { closedAt: string }).closedAt).toBe(closed.closedAt);

    const second = await ctx.app.inject({ method: 'POST', url: `/api/v1/ai/publications/${publicationId}/close`, headers: { authorization: `Bearer ${ctx.ownerToken}` } });
    expect(second.statusCode).toBe(202);
    await delay(30);
    expect(ctx.quiz.calls.filter((call) => call.path === `/device/v1/publications/${publicationId}/close`)).toHaveLength(1);
  });

  it('Q-36: withdrawing and re-showing a closed publication renders reveal mode without reopening acceptance', async () => {
    ctx = await createContext();
    const sessionId = await startAndConfirm(ctx);
    await openQuizSession(ctx, sessionId);
    const questionId = await createDraftQuestion(ctx);
    await sendToProjector(ctx, questionId);
    await waitFor(() => publicationFor(ctx, questionId).state === 'open');
    const publicationId = publicationFor(ctx, questionId).id;

    const withdraw = await ctx.app.inject({ method: 'PUT', url: '/api/v1/ai/projector', headers: { authorization: `Bearer ${ctx.ownerToken}` }, payload: { publicationId: null } });
    expect(withdraw.statusCode).toBe(202);
    await waitFor(() => ctx.pm.calls.filter((call) => call.path === '/consumers/projector').some((call) => (call.body as { mode: string }).mode === 'passthrough'));
    await waitFor(() => publicationFor(ctx, questionId).projectorState === 'withdrawn');
    expect(publicationFor(ctx, questionId).state).toBe('open'); // withdraw never touches acceptance state

    await ctx.app.inject({ method: 'POST', url: `/api/v1/ai/publications/${publicationId}/close`, headers: { authorization: `Bearer ${ctx.ownerToken}` } });
    await waitFor(() => publicationFor(ctx, questionId).state === 'closed');

    const reshow = await ctx.app.inject({ method: 'PUT', url: '/api/v1/ai/projector', headers: { authorization: `Bearer ${ctx.ownerToken}` }, payload: { publicationId } });
    expect(reshow.statusCode).toBe(202);
    await waitFor(() => {
      const call = [...ctx.pm.calls].reverse().find((c) => c.path === '/consumers/projector');
      return call !== undefined && (call.body as { questionPayload?: { correctOptionId?: string } }).questionPayload?.correctOptionId !== undefined;
    });
    const revealCall = [...ctx.pm.calls].reverse().find((call) => call.path === '/consumers/projector')!;
    const revealBody = revealCall.body as { questionPayload: { correctOptionId: string } };
    const question = ctx.app.db.select().from(questions).where(eq(questions.id, questionId)).get()!;
    expect(revealBody.questionPayload.correctOptionId).toBe(question.correctOptionId);
    expect(publicationFor(ctx, questionId).state).toBe('closed'); // still closed — reveal never reopens acceptance
  });

  it('Q-15/Q-22: sending the only question of a ready set to the projector reviews the set once it is sent', async () => {
    ctx = await createContext();
    const sessionId = await startAndConfirm(ctx);
    await openQuizSession(ctx, sessionId);

    // Fabricate a `ready` generated set with one draft question — the state this task's own step-1 fixture would leave B-30 in, without re-driving generation here.
    const setId = ctx.app.ids.next(ctx.clock.now());
    ctx.app.db
      .insert(questionSets)
      .values({
        id: setId,
        sessionId,
        trigger: 'manual',
        state: 'ready',
        requestedAt: ctx.clock.now().toISOString(),
        completedAt: ctx.clock.now().toISOString(),
        intervalMinutesAtRequest: 20,
        inputWindow: { fromOffsetMs: 0, toOffsetMs: 1000 },
        slideCaptureIds: [],
        modelId: 'llama',
        promptVersion: 'mcq/v1',
        requestedCount: 3,
        returnedCount: 1,
        error: null,
      })
      .run();
    const questionId = ctx.app.ids.next(ctx.clock.now());
    ctx.app.db
      .insert(questions)
      .values({
        id: questionId,
        sessionId,
        questionSetId: setId,
        kind: 'mcq',
        prompt: 'Generated?',
        correctOptionId: null,
        provenance: 'generated',
        edited: false,
        state: 'draft',
        createdAt: ctx.clock.now().toISOString(),
        createdBy: null,
        orderHint: null,
      })
      .run();
    const optionA = ctx.app.ids.next(ctx.clock.now());
    const optionB = ctx.app.ids.next(ctx.clock.now());
    ctx.app.db
      .insert(questionOptions)
      .values([
        { id: optionA, questionId, label: 'A', text: 'yes', position: 0 },
        { id: optionB, questionId, label: 'B', text: 'no', position: 1 },
      ])
      .run();
    ctx.app.db.update(questions).set({ correctOptionId: optionA }).where(eq(questions.id, questionId)).run();

    const { statusCode } = await sendToProjector(ctx, questionId);
    expect(statusCode).toBe(202);
    await waitFor(() => ctx.app.db.select().from(questions).where(eq(questions.id, questionId)).get()!.state === 'sent');
    await waitFor(() => ctx.app.db.select().from(questionSets).where(eq(questionSets.id, setId)).get()!.state === 'reviewed');
    expect(ctx.setEvents.some((event) => event.setId === setId && event.state === 'reviewed')).toBe(true);
  });

  it('Q-17/Q-34: ending the session discards a still-ready set and closes the open publication (closeReason=session-ended)', async () => {
    ctx = await createContext();
    const sessionId = await startAndConfirm(ctx);
    await openQuizSession(ctx, sessionId);
    const questionId = await createDraftQuestion(ctx);
    await sendToProjector(ctx, questionId);
    await waitFor(() => publicationFor(ctx, questionId).state === 'open');

    const setId = ctx.app.ids.next(ctx.clock.now());
    ctx.app.db
      .insert(questionSets)
      .values({
        id: setId,
        sessionId,
        trigger: 'manual',
        state: 'ready',
        requestedAt: ctx.clock.now().toISOString(),
        completedAt: ctx.clock.now().toISOString(),
        intervalMinutesAtRequest: 20,
        inputWindow: { fromOffsetMs: 0, toOffsetMs: 1000 },
        slideCaptureIds: [],
        modelId: 'llama',
        promptVersion: 'mcq/v1',
        requestedCount: 3,
        returnedCount: 0,
        error: null,
      })
      .run();

    const stopResponse = await ctx.app.inject({ method: 'POST', url: '/api/v1/recording/stop', headers: { authorization: `Bearer ${ctx.ownerToken}` } });
    expect(stopResponse.statusCode).toBe(202);
    await waitFor(() => ctx.pm.calls.some((call) => call.path === `/consumers/${FIRST_CONSUMER_ID}/stop`));
    ctx.pm.publish('evt.pm.consumer.eos', { consumerId: FIRST_CONSUMER_ID });
    await waitFor(() => currentSession(ctx).state === 'completed');

    await waitFor(() => publicationFor(ctx, questionId).state === 'closed');
    expect(publicationFor(ctx, questionId).closeReason).toBe('session-ended');
    await waitFor(() => ctx.app.db.select().from(questionSets).where(eq(questionSets.id, setId)).get()!.state === 'discarded');
    expect(ctx.setEvents.some((event) => event.setId === setId && event.state === 'discarded')).toBe(true);
  });
});
