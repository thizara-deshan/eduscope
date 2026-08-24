import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { ulid } from 'ulidx';
import type { FastifyInstance } from 'fastify';
import type WebSocket from 'ws';
import { zStudentEventEnvelope, zStudentQuizResultPayload, zStudentServerEvent } from '@eduscope/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { hashDeviceCredential } from '../../src/device/credentials.js';
import { SystemClock } from '../../src/lib/clock.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { startTestPostgres, type TestPostgres } from '../helpers/postgres.js';

function deviceHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

/** See stream.test.ts — `injectWS` synthesizes a socket-less request, which crashes the app's trustProxy-driven request logger; this fake socket is a test-harness-only workaround. */
const INJECT_WS_UPGRADE_CONTEXT = { socket: { remoteAddress: '127.0.0.1', remotePort: 1 } };

function collectFrames(ws: WebSocket): unknown[] {
  const frames: unknown[] = [];
  ws.on('message', (data: Buffer) => frames.push(JSON.parse(data.toString())));
  return frames;
}

async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: condition not met in time');
    await delay(5);
  }
}

describe('student realtime contract (events.md §5 — quiz-service -> student)', () => {
  let pg: TestPostgres;
  let app: FastifyInstance;
  let deviceId: string;
  let deviceToken: string;
  let quizSessionId: string;
  let cookie: string;
  let publicationId: string;
  let correctOptionId: string;

  beforeAll(async () => {
    pg = await startTestPostgres();
    const config = loadConfig({ NODE_ENV: 'test', QUIZ_SERVICE_DATABASE_URL: pg.connectionString });
    app = await buildApp({ config, clock: new SystemClock(), ids: new UlidGenerator() });
    // See test/student/stream.test.ts — `injectWS` bypasses the usual `app.ready()` bootstrap.
    await app.ready();

    deviceId = ulid();
    deviceToken = `contract-device-${randomUUID()}-bearer-token`;
    await app.sql`
      INSERT INTO devices (device_id, credential_hash, hall_display_name, enabled, created_at)
      VALUES (${deviceId}, ${await hashDeviceCredential(deviceToken)}, 'Contract Hall', true, now())
    `;

    quizSessionId = ulid();
    const joinCode = `E${randomUUID().slice(0, 5).toUpperCase()}`;
    await app.sql`
      INSERT INTO quiz_sessions (id, lecture_session_id, device_id, hall_display_name, join_code, join_url, state, opened_at, next_answer_seq)
      VALUES (${quizSessionId}, ${ulid()}, ${deviceId}, 'Contract Hall', ${joinCode}, ${`https://quiz.example/j/${joinCode}`}, 'open', now(), 0)
    `;

    const registerResponse = await app.inject({
      method: 'POST',
      url: `/api/student/v1/quiz-sessions/${quizSessionId}/participants`,
      payload: { fullName: 'Contract Student', studentIdNumber: 'CS1234567' },
    });
    const registerCookie = registerResponse.cookies.find((c) => c.name === 'eduscope_participant');
    cookie = `eduscope_participant=${registerCookie!.value}`;

    publicationId = ulid();
    correctOptionId = ulid();
    const wrongOptionId = ulid();
    const publishResponse = await app.inject({
      method: 'POST',
      url: '/device/v1/publications',
      headers: deviceHeaders(deviceToken),
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
    expect(publishResponse.statusCode).toBe(201);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  it('captures a full cold-connect + close live session and every frame parses as zStudentEventEnvelope', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/student/v1/publications/${publicationId}/answers`,
      headers: { cookie },
      payload: { selectedOptionId: correctOptionId },
    });

    const ws = await app.injectWS('/api/student/v1/stream', { ...INJECT_WS_UPGRADE_CONTEXT, headers: { cookie } } as never);
    const frames = collectFrames(ws);
    await waitFor(() => frames.length >= 3);

    await app.inject({
      method: 'POST',
      url: `/device/v1/publications/${publicationId}/close`,
      headers: deviceHeaders(deviceToken),
      payload: { publicationId, closedAt: new Date().toISOString(), closeReason: 'lecturer-closed' },
    });
    await waitFor(() => frames.length >= 5);
    await delay(30);

    expect(frames.length).toBeGreaterThanOrEqual(5);
    const eventNames = new Set<string>();
    for (const frame of frames) {
      const parsed = zStudentEventEnvelope.parse(frame);
      eventNames.add(parsed.event);
    }
    // Every frame this live session produced round-trips through the exact §5 envelope shape.
    expect([...eventNames].sort()).toEqual(['quiz.participant', 'quiz.question', 'quiz.result', 'quiz.session'].sort());

    const result = frames.find((f) => (f as { event: string }).event === 'quiz.result');
    expect((result as { payload: { rankState: string } }).payload.rankState).toBe('current');

    ws.close();
  });

  it('declares exactly the four §5 student event names in the shared discriminated union', () => {
    const members = new Set(zStudentServerEvent.options.map((option) => option.shape.event.value as string));
    expect([...members].sort()).toEqual(['quiz.participant', 'quiz.question', 'quiz.result', 'quiz.session']);
  });

  it('accepts both declared rankState shapes on a result fixture — pending and current — even though the sync path only ever emits current', () => {
    const base = {
      publicationId: correctOptionId, // any Ulid-shaped id works for this fixture
      question: { prompt: 'Q', options: [{ id: correctOptionId, label: 'A', text: 'x' }, { id: ulid(), label: 'B', text: 'y' }] },
      selectedOptionId: correctOptionId,
      isCorrect: true,
      correctOptionId,
      pointsAwarded: 10,
      runningScore: 10,
      ownRank: 1,
    };
    expect(() => zStudentQuizResultPayload.parse({ ...base, rankState: 'current' })).not.toThrow();
    expect(() => zStudentQuizResultPayload.parse({ ...base, rankState: 'pending' })).not.toThrow();
  });
});
