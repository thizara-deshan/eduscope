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

/** See stream.test.ts — `injectWS` synthesizes a socket-less request, which crashes the app's trustProxy-driven request logger; this fake socket is a test-harness-only workaround. */
const INJECT_WS_UPGRADE_CONTEXT = { socket: { remoteAddress: '127.0.0.1', remotePort: 1 } };

async function startHarness(pg: TestPostgres): Promise<Harness> {
  const config = loadConfig({ NODE_ENV: 'test', QUIZ_SERVICE_DATABASE_URL: pg.connectionString });
  const app = await buildApp({ config, clock: new SystemClock(), ids: new UlidGenerator() });
  // See stream.test.ts — `injectWS` bypasses the usual `app.ready()` bootstrap.
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

interface Participant {
  cookie: string;
  studentIdNumber: string;
  fullName: string;
}

async function registerParticipant(harness: Harness, quizSessionId: string, fullName: string, studentIdNumber: string): Promise<Participant> {
  const response = await harness.app.inject({
    method: 'POST',
    url: `/api/student/v1/quiz-sessions/${quizSessionId}/participants`,
    payload: { fullName, studentIdNumber },
  });
  expect(response.statusCode).toBe(200);
  const cookie = response.cookies.find((c) => c.name === 'eduscope_participant');
  return { cookie: `eduscope_participant=${cookie!.value}`, studentIdNumber, fullName };
}

interface PublishedQuestion {
  publicationId: string;
  correctOptionId: string;
  wrongOptionId: string;
}

async function publish(harness: Harness, quizSessionId: string): Promise<PublishedQuestion> {
  const correctOptionId = ulid();
  const wrongOptionId = ulid();
  const publicationId = ulid();
  const response = await harness.app.inject({
    method: 'POST',
    url: '/device/v1/publications',
    headers: deviceHeaders(harness.deviceToken),
    payload: {
      publicationId,
      quizSessionId,
      questionId: ulid(),
      prompt: 'What is 2+2?',
      options: [
        { id: correctOptionId, label: 'A', text: 'Correct' },
        { id: wrongOptionId, label: 'B', text: 'Wrong' },
      ],
      correctOptionId,
      publishedAt: new Date().toISOString(),
    },
  });
  expect(response.statusCode).toBe(201);
  return { publicationId, correctOptionId, wrongOptionId };
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

describe('student stream privacy (events.md §5 — no cross-participant leakage)', () => {
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

  it('never mentions another participant\'s id, name, or answer in the closed question/result frames', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);
    const alice = await registerParticipant(harness, quizSessionId, 'Alice Wonderland', 'AL0000001');
    const bob = await registerParticipant(harness, quizSessionId, 'Bob Marley', 'BM0000002');
    const { publicationId, correctOptionId, wrongOptionId } = await publish(harness, quizSessionId);

    await submitAnswer(harness, alice.cookie, publicationId, correctOptionId);
    await submitAnswer(harness, bob.cookie, publicationId, wrongOptionId);

    const aliceWs = await connectStream(harness, alice.cookie);
    const aliceFrames = collectFrames(aliceWs);
    await waitFor(() => aliceFrames.length >= 3);

    await closePublication(harness, publicationId);
    await waitFor(() => aliceFrames.length >= 5);

    const serialized = JSON.stringify(aliceFrames);
    expect(serialized).not.toContain(bob.studentIdNumber);
    expect(serialized).not.toContain(bob.fullName);

    // wrongOptionId is legitimately visible as one of the question's own
    // public multiple-choice options — the privacy property under test is
    // that it never appears as *Alice's own* selection (Bob's pick, not hers).
    const result = aliceFrames.find((f) => f.event === 'quiz.result')!;
    expect((result.payload as { selectedOptionId: string }).selectedOptionId).toBe(correctOptionId);
    expect((result.payload as { selectedOptionId: string }).selectedOptionId).not.toBe(wrongOptionId);
  });

  it('never contains correctOptionId, another participant, or leaderboard data on an open question', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);
    const alice = await registerParticipant(harness, quizSessionId, 'Alice Wonderland', 'AL0000003');
    const bob = await registerParticipant(harness, quizSessionId, 'Bob Marley', 'BM0000004');
    const { publicationId, correctOptionId } = await publish(harness, quizSessionId);
    await submitAnswer(harness, bob.cookie, publicationId, correctOptionId);

    const aliceWs = await connectStream(harness, alice.cookie);
    const aliceFrames = collectFrames(aliceWs);
    await waitFor(() => aliceFrames.length >= 3);
    await delay(30);

    const question = aliceFrames.find((f) => f.event === 'quiz.question')!;
    expect(question.payload).toMatchObject({ state: 'open', ownAnswerOptionId: null });
    const serialized = JSON.stringify(question);
    expect(serialized).not.toContain('correctOptionId');
    expect(serialized).not.toContain(bob.studentIdNumber);
    expect(serialized).not.toContain(bob.fullName);
  });

  it('each participant\'s own result reflects only their own outcome, never the other\'s', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);
    const alice = await registerParticipant(harness, quizSessionId, 'Alice Wonderland', 'AL0000005');
    const bob = await registerParticipant(harness, quizSessionId, 'Bob Marley', 'BM0000006');
    const { publicationId, correctOptionId, wrongOptionId } = await publish(harness, quizSessionId);
    await submitAnswer(harness, alice.cookie, publicationId, correctOptionId);
    await submitAnswer(harness, bob.cookie, publicationId, wrongOptionId);

    const aliceWs = await connectStream(harness, alice.cookie);
    const aliceFrames = collectFrames(aliceWs);
    const bobWs = await connectStream(harness, bob.cookie);
    const bobFrames = collectFrames(bobWs);
    await waitFor(() => aliceFrames.length >= 3 && bobFrames.length >= 3);

    await closePublication(harness, publicationId);
    await waitFor(() => aliceFrames.length >= 5 && bobFrames.length >= 5);

    const aliceResult = aliceFrames.find((f) => f.event === 'quiz.result')!;
    const bobResult = bobFrames.find((f) => f.event === 'quiz.result')!;
    expect(aliceResult.payload).toMatchObject({ selectedOptionId: correctOptionId, isCorrect: true, pointsAwarded: 10 });
    expect(bobResult.payload).toMatchObject({ selectedOptionId: wrongOptionId, isCorrect: false, pointsAwarded: 0 });
    expect(JSON.stringify(aliceResult)).not.toContain(bob.studentIdNumber);
    expect(JSON.stringify(bobResult)).not.toContain(alice.studentIdNumber);
  });
});
