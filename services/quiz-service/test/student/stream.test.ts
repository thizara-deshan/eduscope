import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { ulid } from 'ulidx';
import type { FastifyInstance } from 'fastify';
import type WebSocket from 'ws';
import type { StudentEventEnvelope } from '@eduscope/shared';
import { afterEach, beforeAll, afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { hashDeviceCredential } from '../../src/device/credentials.js';
import { SystemClock } from '../../src/lib/clock.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { startTestPostgres, type TestPostgres } from '../helpers/postgres.js';

interface Harness {
  app: FastifyInstance;
  deviceId: string;
  deviceToken: string;
}

/**
 * `@fastify/websocket`'s `injectWS` synthesizes a bare request object with no
 * `.socket` at all (see its source), so the app's `trustProxy: '127.0.0.1'`
 * (a fixed D-01 production requirement — real sockets always have this)
 * makes Fastify's default request-log serializer crash reading
 * `req.socket.remotePort` while resolving `req.ip`. This fake socket is a
 * test-harness-only workaround for that gap; it changes nothing production
 * ever sees, since real upgrades always arrive over a real `net.Socket`.
 */
const INJECT_WS_UPGRADE_CONTEXT = { socket: { remoteAddress: '127.0.0.1', remotePort: 1 } };

async function startHarness(pg: TestPostgres): Promise<Harness> {
  const config = loadConfig({ NODE_ENV: 'test', QUIZ_SERVICE_DATABASE_URL: pg.connectionString });
  const app = await buildApp({ config, clock: new SystemClock(), ids: new UlidGenerator() });
  // `injectWS` emits the upgrade directly on the raw server, bypassing the
  // usual `app.ready()` bootstrap that `.inject()` performs implicitly — a
  // websocket upgrade as the very first request on a freshly built app can
  // otherwise hit not-yet-compiled hook arrays.
  await app.ready();

  const deviceId = ulid();
  const deviceToken = `device-${randomUUID()}-bearer-token`;
  await app.sql`
    INSERT INTO devices (device_id, credential_hash, hall_display_name, enabled, created_at)
    VALUES (${deviceId}, ${await hashDeviceCredential(deviceToken)}, 'Hall A', true, now())
  `;

  return { app, deviceId, deviceToken };
}

function deviceHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

async function seedQuizSession(harness: Harness): Promise<string> {
  const id = ulid();
  const joinCode = `A${randomUUID().slice(0, 5).toUpperCase()}`;
  await harness.app.sql`
    INSERT INTO quiz_sessions
      (id, lecture_session_id, device_id, hall_display_name, join_code, join_url, state, opened_at, next_answer_seq)
    VALUES
      (${id}, ${ulid()}, ${harness.deviceId}, 'Hall A', ${joinCode}, ${`https://quiz.example/j/${joinCode}`}, 'open', now(), 0)
  `;
  return id;
}

let studentIdCounter = 0;
function nextStudentIdNumber(): string {
  studentIdCounter += 1;
  return `ST${studentIdCounter.toString().padStart(7, '0')}`;
}

interface Participant {
  cookie: string;
  studentIdNumber: string;
}

async function registerParticipant(
  harness: Harness,
  quizSessionId: string,
  fullName = 'Ada Lovelace',
): Promise<Participant> {
  const studentIdNumber = nextStudentIdNumber();
  const response = await harness.app.inject({
    method: 'POST',
    url: `/api/student/v1/quiz-sessions/${quizSessionId}/participants`,
    payload: { fullName, studentIdNumber },
  });
  expect(response.statusCode).toBe(200);
  const cookie = response.cookies.find((c) => c.name === 'eduscope_participant');
  return { cookie: `eduscope_participant=${cookie!.value}`, studentIdNumber };
}

interface PublishedOption {
  id: string;
  label: 'A' | 'B';
  text: string;
}

interface PublishedQuestion {
  publicationId: string;
  correctOptionId: string;
  wrongOptionId: string;
  options: PublishedOption[];
}

async function publish(harness: Harness, quizSessionId: string): Promise<PublishedQuestion> {
  const correctOptionId = ulid();
  const wrongOptionId = ulid();
  const publicationId = ulid();
  const options: PublishedOption[] = [
    { id: correctOptionId, label: 'A', text: 'Correct' },
    { id: wrongOptionId, label: 'B', text: 'Wrong' },
  ];
  const response = await harness.app.inject({
    method: 'POST',
    url: '/device/v1/publications',
    headers: deviceHeaders(harness.deviceToken),
    payload: {
      publicationId,
      quizSessionId,
      questionId: ulid(),
      prompt: 'What is 2+2?',
      options,
      correctOptionId,
      publishedAt: new Date().toISOString(),
    },
  });
  expect(response.statusCode).toBe(201);
  return { publicationId, correctOptionId, wrongOptionId, options };
}

async function closePublication(harness: Harness, publicationId: string): Promise<void> {
  const response = await harness.app.inject({
    method: 'POST',
    url: `/device/v1/publications/${publicationId}/close`,
    headers: deviceHeaders(harness.deviceToken),
    payload: { publicationId, closedAt: new Date().toISOString(), closeReason: 'lecturer-closed' },
  });
  expect(response.statusCode).toBe(204);
}

async function closeSession(harness: Harness, quizSessionId: string): Promise<void> {
  const response = await harness.app.inject({
    method: 'POST',
    url: `/device/v1/quiz-sessions/${quizSessionId}/close`,
    headers: deviceHeaders(harness.deviceToken),
  });
  expect(response.statusCode).toBe(204);
}

async function submitAnswer(harness: Harness, cookie: string, publicationId: string, selectedOptionId: string): Promise<void> {
  const response = await harness.app.inject({
    method: 'POST',
    url: `/api/student/v1/publications/${publicationId}/answers`,
    headers: { cookie },
    payload: { selectedOptionId },
  });
  expect(response.statusCode).toBe(200);
}

async function connectStream(harness: Harness, cookie: string): Promise<WebSocket> {
  return harness.app.injectWS('/api/student/v1/stream', { ...INJECT_WS_UPGRADE_CONTEXT, headers: { cookie } } as never);
}

function collectFrames(ws: WebSocket): StudentEventEnvelope[] {
  const frames: StudentEventEnvelope[] = [];
  ws.on('message', (data: Buffer) => frames.push(JSON.parse(data.toString()) as StudentEventEnvelope));
  return frames;
}

async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: condition not met in time');
    await delay(5);
  }
}

function waitForClose(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    ws.once('close', (code: number, reasonBuf: Buffer) => resolve({ code, reason: reasonBuf.toString() }));
  });
}

describe('student realtime stream (events.md §5, cold snapshot + fan-out)', () => {
  let pg: TestPostgres;
  let harness: Harness | undefined;

  beforeAll(async () => {
    pg = await startTestPostgres();
  }, 60_000);

  afterEach(async () => {
    await delay(30);
    await harness?.app.close();
    harness = undefined;
  });

  afterAll(async () => {
    await pg?.stop();
  });

  it('rejects an upgrade with no participant cookie', async () => {
    harness = await startHarness(pg);
    await expect(harness.app.injectWS('/api/student/v1/stream', INJECT_WS_UPGRADE_CONTEXT as never)).rejects.toThrow(/401/);
  });

  it('ignores a credential offered via query string — only the cookie authenticates', async () => {
    harness = await startHarness(pg);
    await expect(
      harness.app.injectWS('/api/student/v1/stream?participantId=not-a-real-id', INJECT_WS_UPGRADE_CONTEXT as never),
    ).rejects.toThrow(/401/);
  });

  it('cold-connects to state:none with just session+participant+question, in that exact order', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);
    const { cookie } = await registerParticipant(harness, quizSessionId);

    const ws = await connectStream(harness, cookie);
    const frames = collectFrames(ws);
    await waitFor(() => frames.length >= 3);
    await delay(30);

    expect(frames.map((f) => f.event)).toEqual(['quiz.session', 'quiz.participant', 'quiz.question']);
    expect(frames.map((f) => f.seq)).toEqual([0, 1, 2]);
    expect(frames[0]).toMatchObject({ payload: { state: 'open' } });
    expect(frames[1]).toMatchObject({ payload: { connectionState: 'online' } });
    expect(frames[2]).toMatchObject({ payload: { state: 'none' } });
  });

  it('cold-connects to an open question with the participant\'s own answer id, no correctOptionId', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);
    const { cookie } = await registerParticipant(harness, quizSessionId);
    const { publicationId, correctOptionId } = await publish(harness, quizSessionId);
    await submitAnswer(harness, cookie, publicationId, correctOptionId);

    const ws = await connectStream(harness, cookie);
    const frames = collectFrames(ws);
    await waitFor(() => frames.length >= 3);

    const question = frames[2]!;
    expect(question.event).toBe('quiz.question');
    expect(question.payload).toMatchObject({ state: 'open', publicationId, ownAnswerOptionId: correctOptionId });
    expect(JSON.stringify(question.payload)).not.toContain('correctOptionId');
  });

  it('cold-connects to a closed question with a private own result including a missed answer', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);
    const { cookie } = await registerParticipant(harness, quizSessionId);
    const { publicationId, correctOptionId } = await publish(harness, quizSessionId);
    await closePublication(harness, publicationId);
    void correctOptionId;

    const ws = await connectStream(harness, cookie);
    const frames = collectFrames(ws);
    await waitFor(() => frames.length >= 4);

    expect(frames.map((f) => f.event)).toEqual(['quiz.session', 'quiz.participant', 'quiz.question', 'quiz.result']);
    expect(frames[2]).toMatchObject({ payload: { state: 'closed', publicationId, ownAnswerOptionId: null } });
    expect(frames[3]).toMatchObject({
      payload: {
        publicationId,
        selectedOptionId: null,
        isCorrect: null,
        correctOptionId,
        pointsAwarded: 0,
        runningScore: 0,
        rankState: 'current',
      },
    });
  });

  it('receives a live quiz.question{open} delta when the device publishes after connect', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);
    const { cookie } = await registerParticipant(harness, quizSessionId);

    const ws = await connectStream(harness, cookie);
    const frames = collectFrames(ws);
    await waitFor(() => frames.length >= 3);

    const { publicationId } = await publish(harness, quizSessionId);
    await waitFor(() => frames.length >= 4);

    const delta = frames[3]!;
    expect(delta.event).toBe('quiz.question');
    expect(delta.seq).toBe(3);
    expect(delta.payload).toMatchObject({ state: 'open', publicationId, ownAnswerOptionId: null });
  });

  it('on close, delivers quiz.question{closed} strictly before the private quiz.result', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);
    const { cookie } = await registerParticipant(harness, quizSessionId);
    const { publicationId, correctOptionId } = await publish(harness, quizSessionId);
    await submitAnswer(harness, cookie, publicationId, correctOptionId);

    const ws = await connectStream(harness, cookie);
    const frames = collectFrames(ws);
    await waitFor(() => frames.length >= 3);
    const beforeClose = frames.length;

    await closePublication(harness, publicationId);
    await waitFor(() => frames.length >= beforeClose + 2);

    const closedQuestion = frames[beforeClose]!;
    const result = frames[beforeClose + 1]!;
    expect(closedQuestion.event).toBe('quiz.question');
    expect(closedQuestion.payload).toMatchObject({ state: 'closed', ownAnswerOptionId: correctOptionId });
    expect(result.event).toBe('quiz.result');
    expect(result.payload).toMatchObject({
      selectedOptionId: correctOptionId,
      isCorrect: true,
      correctOptionId,
      pointsAwarded: 10,
      runningScore: 10,
      rankState: 'current',
    });
    expect(closedQuestion.seq).toBeLessThan(result.seq);
  });

  it('session close sends a private terminal quiz.session with participationState participated', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);
    const { cookie } = await registerParticipant(harness, quizSessionId);
    const { publicationId, correctOptionId } = await publish(harness, quizSessionId);
    await submitAnswer(harness, cookie, publicationId, correctOptionId);
    await closePublication(harness, publicationId);

    const ws = await connectStream(harness, cookie);
    const frames = collectFrames(ws);
    await waitFor(() => frames.length >= 4);
    const before = frames.length;

    await closeSession(harness, quizSessionId);
    await waitFor(() => frames.length >= before + 1);

    const terminal = frames[before]!;
    expect(terminal.event).toBe('quiz.session');
    expect(terminal.payload).toMatchObject({
      state: 'closed',
      participationState: 'participated',
      finalScore: 10,
      finalRank: 1,
      answeredCount: 1,
    });
  });

  it('session close sends participationState none for a participant who never answered', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);
    const { cookie } = await registerParticipant(harness, quizSessionId);

    const ws = await connectStream(harness, cookie);
    const frames = collectFrames(ws);
    await waitFor(() => frames.length >= 3);
    const before = frames.length;

    await closeSession(harness, quizSessionId);
    await waitFor(() => frames.length >= before + 1);

    const terminal = frames[before]!;
    expect(terminal.payload).toMatchObject({
      state: 'closed',
      participationState: 'none',
      finalScore: 0,
      finalRank: null,
      answeredCount: 0,
    });
  });

  it('assigns contiguous per-connection seq starting at 0 across snapshot and live deltas', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);
    const { cookie } = await registerParticipant(harness, quizSessionId);

    const ws = await connectStream(harness, cookie);
    const frames = collectFrames(ws);
    await waitFor(() => frames.length >= 3);

    await publish(harness, quizSessionId);
    await waitFor(() => frames.length >= 4);

    expect(frames.map((f) => f.seq)).toEqual(frames.map((_, index) => index));
  });

  it('a reconnect replaces the old socket and delivers a fresh atomic snapshot', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);
    const { cookie } = await registerParticipant(harness, quizSessionId);

    const first = await connectStream(harness, cookie);
    const firstFrames = collectFrames(first);
    await waitFor(() => firstFrames.length >= 3);
    const firstClosed = waitForClose(first);

    const second = await connectStream(harness, cookie);
    const secondFrames = collectFrames(second);
    await waitFor(() => secondFrames.length >= 3);

    const closeEvent = await firstClosed;
    expect(closeEvent.code).toBe(4000);
    expect(secondFrames.map((f) => f.seq)).toEqual([0, 1, 2]);
    expect(secondFrames.map((f) => f.event)).toEqual(['quiz.session', 'quiz.participant', 'quiz.question']);
    void quizSessionId;
  });

  it('the superseded old socket closing afterward cannot mark the new connection offline', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);
    const { cookie } = await registerParticipant(harness, quizSessionId);
    void quizSessionId;

    const first = await connectStream(harness, cookie);
    collectFrames(first);
    await waitFor(() => first.readyState === first.OPEN || first.readyState === first.CLOSING);

    const second = await connectStream(harness, cookie);
    const secondFrames = collectFrames(second);
    await waitFor(() => secondFrames.length >= 3);
    await delay(50);

    const [row] = await harness.app.sql`SELECT connection_state FROM participants LIMIT 1`;
    expect(row?.connection_state).toBe('online');
  });

  it('a publish racing a fresh connect is represented in the snapshot or exactly one later delta, never dropped', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);
    const { cookie } = await registerParticipant(harness, quizSessionId);

    const [ws] = await Promise.all([connectStream(harness, cookie), publish(harness, quizSessionId)]);
    const frames = collectFrames(ws);
    await waitFor(
      () => frames.some((f) => f.event === 'quiz.question' && (f.payload as { state: string }).state === 'open'),
      5000,
    );
    await delay(50);

    // Whether the publish lands before or after the connect's own snapshot
    // read, the open question must appear exactly once — either as the cold
    // snapshot's question frame or as exactly one live delta, never both and
    // never dropped.
    const openQuestionFrames = frames.filter(
      (f) => f.event === 'quiz.question' && (f.payload as { state: string }).state === 'open',
    );
    expect(openQuestionFrames).toHaveLength(1);
  });
});
