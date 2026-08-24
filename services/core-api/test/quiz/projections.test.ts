import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { FastifyInstance } from 'fastify';
import type { Leaderboard, QuizResponsesPayload, QuizScoreInput, QuizSessionPayload, SystemAlert } from '@eduscope/shared';
import { scoreQuizParticipants } from '@eduscope/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { lectureSessions, questionPublications, questionOptions, questions, quizSessionProjections, storageVolumes, users } from '../../src/db/schema.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { ingestAnswers, type AnswerBatchItem } from '../../src/modules/quiz/responses.js';
import { FakeAiServices } from '../fakes/ai-services.js';
import { FakeClock } from '../fakes/clock.js';
import { FakePipelineManager } from '../fakes/pipeline-manager.js';
import { FakeQuizService } from '../fakes/quiz-service.js';

const NOW = new Date('2026-08-20T08:00:00.000Z');
const BEARER = 'quiz-projections-test-internal-bearer';
const QUIZ_BEARER = 'quiz-projections-test-device-bearer';
const FIRST_CONSUMER_ID = 'record:00000001';

function fullProvisioning(): Record<string, unknown> {
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
  sessionEvents: QuizSessionPayload[];
  responsesEvents: QuizResponsesPayload[];
  alertEvents: SystemAlert[];
}

async function loginAs(app: FastifyInstance, username: string, password: string): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password, client: 'panel' } });
  return (response.json() as { tokens: { accessToken: string } }).tokens.accessToken;
}

async function createContext(): Promise<TestContext> {
  const dir = mkdtempSync(join(tmpdir(), 'core-api-quiz-projections-'));
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
    CORE_API_JWT_SECRET: 'quiz-projections-test-secret',
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
  const responsesEvents: QuizResponsesPayload[] = [];
  app.bus.subscribe('quiz.responses', (payload) => responsesEvents.push(payload));
  const alertEvents: SystemAlert[] = [];
  app.bus.subscribe('system.alert', (payload) => alertEvents.push(payload));

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
  return { dir, app, clock, pm, ai, quiz, ownerToken, sessionEvents, responsesEvents, alertEvents };
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

function quizRow(ctx: TestContext): typeof quizSessionProjections.$inferSelect | undefined {
  return ctx.app.db.select().from(quizSessionProjections).all()[0];
}

async function getQuizSession(ctx: TestContext): Promise<{ state: string; joinCode: string | null; joinUrl: string | null; joinedCount: number; syncState: string | null }> {
  const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/quiz/session', headers: { authorization: `Bearer ${ctx.ownerToken}` } });
  return response.json() as { state: string; joinCode: string | null; joinUrl: string | null; joinedCount: number; syncState: string | null };
}

/** Publishes a question directly to a `sent` publication under the given quiz session — reuses B-32's flow via HTTP so B-33's tests exercise real cross-module state. */
async function createOpenPublication(ctx: TestContext, _sessionId: string, prompt = 'What is 2+2?'): Promise<{ publicationId: string; questionId: string; optionAId: string; optionBId: string }> {
  const create = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/ai/questions',
    headers: { authorization: `Bearer ${ctx.ownerToken}` },
    payload: { prompt, options: [{ text: '3', isCorrect: false }, { text: '4', isCorrect: true }] },
  });
  expect(create.statusCode).toBe(202);
  const question = ctx.app.db.select().from(questions).where(eq(questions.prompt, prompt)).all().at(-1)!;
  const options = ctx.app.db.select().from(questionOptions).where(eq(questionOptions.questionId, question.id)).orderBy(questionOptions.position).all();

  const send = await ctx.app.inject({ method: 'POST', url: `/api/v1/ai/questions/${question.id}/send-to-projector`, headers: { authorization: `Bearer ${ctx.ownerToken}` } });
  expect(send.statusCode).toBe(202);
  await waitFor(() => {
    const row = ctx.app.db.select().from(questionPublications).where(eq(questionPublications.questionId, question.id)).get();
    return row?.state === 'open';
  });
  const publication = ctx.app.db.select().from(questionPublications).where(eq(questionPublications.questionId, question.id)).get()!;
  return { publicationId: publication.id, questionId: question.id, optionAId: options[0]!.id, optionBId: options[1]!.id };
}

describe('Quiz projection reads (Z-01..Z-06/Z-30..Z-33, machine 4a/4d)', () => {
  let ctx: TestContext;

  afterEach(async () => {
    await delay(50);
    await destroyContext(ctx);
  });

  it('Z-01/Z-02: recording start mints a quiz session; getQuizSession reflects requesting then open with joinCode/joinUrl', async () => {
    ctx = await createContext();
    const before = await getQuizSession(ctx);
    expect(before.state).toBe('absent');

    const sessionId = await startAndConfirm(ctx);
    await waitFor(() => ctx.sessionEvents.some((event) => event.state === 'requesting'));

    await waitFor(() => ctx.quiz.calls.some((call) => call.path === '/device/v1/quiz-sessions'));
    const createCall = ctx.quiz.calls.find((call) => call.path === '/device/v1/quiz-sessions')!;
    expect((createCall.body as { lectureSessionId: string }).lectureSessionId).toBe(sessionId);
    expect(createCall.contractVersion).toBe('1.0');

    await waitFor(async () => (await getQuizSession(ctx)).state === 'open');
    const open = await getQuizSession(ctx);
    expect(open.joinCode).toBe('AB12CD');
    expect(open.joinUrl).toMatch(/^https:\/\/quiz\.example\.edu\/j\//);
    expect(quizRow(ctx)?.lectureSessionId).toBe(sessionId);
  });

  it('Z-03: no response within T-QUIZ-CREATE after 2 retries marks failed and raises quiz.unavailable', async () => {
    ctx = await createContext();
    ctx.quiz.setOffline(true);
    await startAndConfirm(ctx);

    ctx.clock.advance(8_000);
    await delay(20);
    ctx.clock.advance(8_000);
    await delay(20);
    ctx.clock.advance(8_000);

    await waitFor(async () => (await getQuizSession(ctx)).state === 'failed');
    expect(ctx.alertEvents.some((alert) => alert.code === 'quiz.unavailable')).toBe(true);
  });

  it('Z-04: a failed session probes again every T-QUIZ-PROBE and recovers once quiz-service answers', async () => {
    ctx = await createContext();
    ctx.quiz.setOffline(true);
    await startAndConfirm(ctx);
    ctx.clock.advance(8_000);
    await delay(20);
    ctx.clock.advance(8_000);
    await delay(20);
    ctx.clock.advance(8_000);
    await waitFor(async () => (await getQuizSession(ctx)).state === 'failed');

    ctx.quiz.setOffline(false);
    ctx.clock.advance(30_000); // T-QUIZ-PROBE
    await waitFor(async () => (await getQuizSession(ctx)).state === 'open');
  });

  it('Z-05: ending the session closes the quiz session remotely and locally', async () => {
    ctx = await createContext();
    await startAndConfirm(ctx);
    await waitFor(async () => (await getQuizSession(ctx)).state === 'open');
    const rowId = quizRow(ctx)!.id;

    const stopResponse = await ctx.app.inject({ method: 'POST', url: '/api/v1/recording/stop', headers: { authorization: `Bearer ${ctx.ownerToken}` } });
    expect(stopResponse.statusCode).toBe(202);
    await waitFor(() => ctx.pm.calls.some((call) => call.path === `/consumers/${FIRST_CONSUMER_ID}/stop`));
    ctx.pm.publish('evt.pm.consumer.eos', { consumerId: FIRST_CONSUMER_ID });
    await waitFor(() => currentSession(ctx).state === 'completed');

    await waitFor(() => ctx.quiz.calls.some((call) => call.path === `/device/v1/quiz-sessions/${rowId}/close`));
    await waitFor(() => ctx.app.db.select().from(quizSessionProjections).where(eq(quizSessionProjections.id, rowId)).get()!.state === 'closed');
    const afterClose = await getQuizSession(ctx);
    expect(afterClose.state).toBe('absent'); // fresh record — ready for the next lecture session
  });

  it('answer upsert (INV-AP-1): replaces the same student+publication key rather than creating a second row, and advances the durable lastAnswerSeq watermark', async () => {
    ctx = await createContext();
    const sessionId = await startAndConfirm(ctx);
    await waitFor(async () => (await getQuizSession(ctx)).state === 'open');
    const { publicationId, optionAId, optionBId } = await createOpenPublication(ctx, sessionId);
    const quizSessionId = quizRow(ctx)!.id;

    const first: AnswerBatchItem = { seq: 1, answerId: 'answer-1', publicationId, studentIdNumber: 'S001', studentDisplayName: 'Alice', selectedOptionId: optionAId, isCorrect: false, responseTimeMs: 1200, submittedAt: NOW.toISOString() };
    ingestAnswers({ db: ctx.app.db, clock: ctx.clock, bus: ctx.app.bus }, quizSessionId, [first]);

    const corrected: AnswerBatchItem = { ...first, seq: 2, answerId: 'answer-2', selectedOptionId: optionBId, isCorrect: true, responseTimeMs: 900 };
    ingestAnswers({ db: ctx.app.db, clock: ctx.clock, bus: ctx.app.bus }, quizSessionId, [corrected]);

    const responses = await ctx.app.inject({ method: 'GET', url: `/api/v1/quiz/publications/${publicationId}/responses`, headers: { authorization: `Bearer ${ctx.ownerToken}` } });
    expect(responses.statusCode).toBe(200);
    const body = responses.json() as { items: Array<{ id: string; selectedOptionId: string; isCorrect: boolean; studentIdNumber: string }> };
    expect(body.items).toHaveLength(1); // replaced, never a second row
    expect(body.items[0]!.id).toBe('answer-2');
    expect(body.items[0]!.selectedOptionId).toBe(optionBId);
    expect(body.items[0]!.isCorrect).toBe(true);

    expect(ctx.app.db.select().from(quizSessionProjections).where(eq(quizSessionProjections.id, quizSessionId)).get()!.lastAnswerSeq).toBe(2);
    expect(ctx.responsesEvents.some((event) => event.publicationId === publicationId && event.deltas.length === 1)).toBe(true);
  });

  it('Z-30/Z-31: silence for T-QUIZ-SYNC-STALE marks the session and open publication stale; activity recovers it', async () => {
    ctx = await createContext();
    const sessionId = await startAndConfirm(ctx);
    await waitFor(async () => (await getQuizSession(ctx)).state === 'open');
    const { publicationId, optionAId } = await createOpenPublication(ctx, sessionId);
    const quizSessionId = quizRow(ctx)!.id;

    ctx.clock.advance(15_000); // T-QUIZ-SYNC-STALE
    await waitFor(async () => (await getQuizSession(ctx)).syncState === 'stale');
    await waitFor(() => ctx.app.db.select().from(questionPublications).where(eq(questionPublications.id, publicationId)).get()!.syncState === 'stale');
    expect(ctx.responsesEvents.some((event) => event.publicationId === publicationId && event.stale === true)).toBe(true);

    const answer: AnswerBatchItem = { seq: 1, answerId: 'answer-recover', publicationId, studentIdNumber: 'S002', studentDisplayName: 'Bob', selectedOptionId: optionAId, isCorrect: false, responseTimeMs: 800, submittedAt: ctx.clock.now().toISOString() };
    ingestAnswers({ db: ctx.app.db, clock: ctx.clock, bus: ctx.app.bus }, quizSessionId, [answer]);
    await waitFor(() => ctx.app.db.select().from(questionPublications).where(eq(questionPublications.id, publicationId)).get()!.syncState === 'synced');
  });

  it('Z-32: silence for T-QUIZ-SYNC-FAIL raises a sync-stale alert while recording stays untouched', async () => {
    ctx = await createContext();
    const sessionId = await startAndConfirm(ctx);
    await waitFor(async () => (await getQuizSession(ctx)).state === 'open');

    ctx.clock.advance(60_000); // T-QUIZ-SYNC-FAIL
    await waitFor(async () => (await getQuizSession(ctx)).syncState === 'failed');
    expect(ctx.alertEvents.some((alert) => alert.code === 'quiz.sync-stale')).toBe(true);
    expect(currentSession(ctx).state).toBe('recording'); // QZ-7 — recording is untouched
    void sessionId;
  });

  it('leaderboard: score = correct×10, accuracy = correct/answered (0 when none), dense rank shares ties, and is never persisted', async () => {
    ctx = await createContext();
    const sessionId = await startAndConfirm(ctx);
    await waitFor(async () => (await getQuizSession(ctx)).state === 'open');
    const { publicationId, optionAId, optionBId } = await createOpenPublication(ctx, sessionId);
    const quizSessionId = quizRow(ctx)!.id;

    const answers: AnswerBatchItem[] = [
      { seq: 1, answerId: 'a-1', publicationId, studentIdNumber: 'S001', studentDisplayName: 'Alice', selectedOptionId: optionBId, isCorrect: true, responseTimeMs: 1000, submittedAt: NOW.toISOString() },
      { seq: 2, answerId: 'a-2', publicationId, studentIdNumber: 'S002', studentDisplayName: 'Bob', selectedOptionId: optionBId, isCorrect: true, responseTimeMs: 2000, submittedAt: NOW.toISOString() },
      { seq: 3, answerId: 'a-3', publicationId, studentIdNumber: 'S003', studentDisplayName: 'Cara', selectedOptionId: optionAId, isCorrect: false, responseTimeMs: 1500, submittedAt: NOW.toISOString() },
    ];
    ingestAnswers({ db: ctx.app.db, clock: ctx.clock, bus: ctx.app.bus }, quizSessionId, answers);

    const response = await ctx.app.inject({ method: 'GET', url: `/api/v1/quiz/leaderboard?sessionId=${encodeURIComponent(sessionId)}`, headers: { authorization: `Bearer ${ctx.ownerToken}` } });
    expect(response.statusCode).toBe(200);
    const leaderboard = response.json() as Leaderboard;
    expect(leaderboard.entries).toHaveLength(3);

    const alice = leaderboard.entries.find((entry) => entry.studentIdNumber === 'S001')!;
    const bob = leaderboard.entries.find((entry) => entry.studentIdNumber === 'S002')!;
    const cara = leaderboard.entries.find((entry) => entry.studentIdNumber === 'S003')!;
    expect(alice.points).toBe(10);
    expect(alice.accuracy).toBe(1);
    expect(cara.points).toBe(0);
    expect(cara.accuracy).toBe(0);
    // Alice and Bob tie at 10 points — dense rank 1 for both, Cara (0 points) is rank 2, not 3.
    expect(alice.rank).toBe(1);
    expect(bob.rank).toBe(1);
    expect(cara.rank).toBe(2);

    // INV-LB-2 parity witness (workstream D master-plan gate flag): the same
    // fixture run through the shared DM-10 helper produces deep-equal entries
    // to B's own getLeaderboard output — one ranking implementation, not two.
    const fixture: QuizScoreInput[] = [
      { studentIdNumber: 'S001', displayName: 'Alice', answered: 1, correct: 1, responseMsTotal: 1000 },
      { studentIdNumber: 'S002', displayName: 'Bob', answered: 1, correct: 1, responseMsTotal: 2000 },
      { studentIdNumber: 'S003', displayName: 'Cara', answered: 1, correct: 0, responseMsTotal: 1500 },
    ];
    const sharedScored = scoreQuizParticipants(fixture);
    const bScored = [...leaderboard.entries].sort((a, b) => a.studentIdNumber.localeCompare(b.studentIdNumber));
    expect(sharedScored.sort((a, b) => a.studentIdNumber.localeCompare(b.studentIdNumber))).toEqual(bScored);
  });
});
