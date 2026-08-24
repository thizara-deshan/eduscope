import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { FakeClock } from '../fakes/clock.js';
import { FakeQuizService } from '../fakes/quiz-service.js';
import { startCoreQuizSyncPeer, waitFor, type QuizSyncPeer } from '../peers/quiz-sync-peer.js';

const QUIZ_BEARER = 'quiz-sync-test-device-bearer';
const DEVICE_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV'; // zUlid-shaped — `sync.hello`'s deviceId is contract-typed as a ULID

interface TestContext {
  quiz: FakeQuizService;
  quizBaseUrl: string;
  peer: QuizSyncPeer;
}

async function createContext(): Promise<TestContext> {
  const quiz = new FakeQuizService({ bearerToken: QUIZ_BEARER });
  const quizBaseUrl = await quiz.listen();
  const peer = await startCoreQuizSyncPeer({ quizServiceBaseUrl: quizBaseUrl, quizDeviceId: DEVICE_ID, quizDeviceBearer: QUIZ_BEARER });
  return { quiz, quizBaseUrl, peer };
}

async function destroyContext(ctx: TestContext): Promise<void> {
  await ctx.peer.close();
  await ctx.quiz.close();
}

describe('Device-side quiz-sync client (events.md §4, machine 4d)', () => {
  let ctx: TestContext;

  afterEach(async () => {
    await delay(50);
    await destroyContext(ctx);
  });

  it('opens exactly one WS connection once the quiz session is open, authenticated with the deviceAuth bearer and contract header, and sends sync.hello first', async () => {
    ctx = await createContext();
    const { quizSessionId } = await ctx.peer.startRecordingAndConfirm();

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
    await ctx.peer.publishQuestion();
    await delay(50);
    expect(ctx.quiz.wsConnections).toHaveLength(1);
  });

  it('sends sync.heartbeat every T-QUIZ-HEARTBEAT (5s)', async () => {
    ctx = await createContext();
    await ctx.peer.startRecordingAndConfirm();
    await waitFor(() => ctx.quiz.wsConnections.length === 1);
    const connection = ctx.quiz.latestWsConnection!;
    await waitFor(() => connection.receivedFrames.length === 1); // hello only, so far

    ctx.peer.advanceClock(5_000);
    await waitFor(() => connection.receivedFrames.length === 2);
    expect((connection.receivedFrames[1] as { type: string }).type).toBe('sync.heartbeat');

    ctx.peer.advanceClock(5_000);
    await waitFor(() => connection.receivedFrames.length === 3);
  });

  it('ingests a sync.answers batch (seq ordering, duplicate idempotency) and records sync activity', async () => {
    ctx = await createContext();
    const { quizSessionId } = await ctx.peer.startRecordingAndConfirm();
    const { publicationId, optionAId } = await ctx.peer.publishQuestion();
    await waitFor(() => ctx.quiz.wsConnections.length === 1);

    const answer = { seq: 1, answerId: ctx.peer.app.ids.next(ctx.peer.clock.now()), publicationId, studentIdNumber: 'S001', studentDisplayName: 'Alice', selectedOptionId: optionAId, isCorrect: false, responseTimeMs: 1000, submittedAt: ctx.peer.clock.now().toISOString() };
    ctx.quiz.sendToLatestConnection({ type: 'sync.answers', quizSessionId, answers: [answer] });
    await waitFor(() => ctx.peer.listAnswerProjections(publicationId).length === 1);
    expect(ctx.peer.watermark(quizSessionId)).toBe(1);

    // duplicate replay (same seq/answerId) — idempotent, no second row, no seq regression.
    ctx.quiz.sendToLatestConnection({ type: 'sync.answers', quizSessionId, answers: [answer] });
    await delay(50);
    expect(ctx.peer.listAnswerProjections(publicationId)).toHaveLength(1);
    expect(ctx.peer.watermark(quizSessionId)).toBe(1);
  });

  it('ingests sync.participants batches into the joined count', async () => {
    ctx = await createContext();
    const { quizSessionId } = await ctx.peer.startRecordingAndConfirm();
    await waitFor(() => ctx.quiz.wsConnections.length === 1);

    ctx.quiz.sendToLatestConnection({ type: 'sync.participants', quizSessionId, joinedCount: 7, onlineCount: 5 });
    await waitFor(async () => (await ctx.peer.snapshotQuizSession()).joinedCount === 7);
  });

  it('wrong-session rejection: a frame naming a different quizSessionId is dropped, not applied', async () => {
    ctx = await createContext();
    const { quizSessionId } = await ctx.peer.startRecordingAndConfirm();
    const { publicationId, optionAId } = await ctx.peer.publishQuestion();
    await waitFor(() => ctx.quiz.wsConnections.length === 1);
    void quizSessionId;

    const answer = { seq: 1, answerId: ctx.peer.app.ids.next(ctx.peer.clock.now()), publicationId, studentIdNumber: 'S001', studentDisplayName: 'Alice', selectedOptionId: optionAId, isCorrect: true, responseTimeMs: 500, submittedAt: ctx.peer.clock.now().toISOString() };
    ctx.quiz.sendToLatestConnection({ type: 'sync.answers', quizSessionId: '01BX5ZZKBKACTAV9WEVGEMMVRZ', answers: [answer] }); // zUlid-shaped but genuinely a different session — exercises the explicit scope check, not zod rejection
    await delay(80);
    expect(ctx.peer.listAnswerProjections(publicationId)).toHaveLength(0);
  });

  it('reconnects with backoff after an ungraceful drop and resends sync.hello', async () => {
    ctx = await createContext();
    await ctx.peer.startRecordingAndConfirm();
    await waitFor(() => ctx.quiz.wsConnections.length === 1);

    ctx.quiz.dropLatestConnection();
    await delay(50);
    expect(ctx.quiz.wsConnections).toHaveLength(1); // no immediate reconnect before the first backoff step elapses

    ctx.peer.advanceClock(500); // T-WS-RECONNECT's first step
    await waitFor(() => ctx.quiz.wsConnections.length === 2);
    const second = ctx.quiz.latestWsConnection!;
    await waitFor(() => second.receivedFrames.length > 0);
    expect((second.receivedFrames[0] as { type: string }).type).toBe('sync.hello');
  });

  it('restarts from the persisted watermark: after a service restart, the fresh sync.hello carries the last ingested seq', async () => {
    ctx = await createContext();
    const { quizSessionId } = await ctx.peer.startRecordingAndConfirm();
    const { publicationId, optionAId } = await ctx.peer.publishQuestion();
    await waitFor(() => ctx.quiz.wsConnections.length === 1);

    const answer = { seq: 5, answerId: ctx.peer.app.ids.next(ctx.peer.clock.now()), publicationId, studentIdNumber: 'S001', studentDisplayName: 'Alice', selectedOptionId: optionAId, isCorrect: true, responseTimeMs: 700, submittedAt: ctx.peer.clock.now().toISOString() };
    ctx.quiz.sendToLatestConnection({ type: 'sync.answers', quizSessionId, answers: [answer] });
    await waitFor(() => ctx.peer.watermark(quizSessionId) === 5);

    const dbPath = ctx.peer.app.config.dbPath;
    await ctx.peer.app.close(); // release the sqlite handle before the restarted instance reopens it (KEEP-style pattern, recording/lifecycle.test.ts)

    const restartConfig = loadConfig({
      NODE_ENV: 'test',
      CORE_API_DB_PATH: dbPath,
      CORE_API_JWT_SECRET: 'quiz-sync-test-secret',
      CORE_API_PROVISIONING_PATH: `${ctx.peer.dir}/provisioning.json`,
      CORE_API_RECORDINGS_ROOT: `${ctx.peer.dir}/recordings`,
      CORE_API_RUNTIME_DIR: `${ctx.peer.dir}/runtime`,
      CORE_API_PM_BASE_URL: 'http://127.0.0.1:1', // unreachable on purpose — restart persistence must not depend on PM being up
      CORE_API_INTERNAL_BEARER: 'quiz-sync-peer-internal-bearer',
    });
    const restartedClock = new FakeClock(ctx.peer.clock.now());
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
