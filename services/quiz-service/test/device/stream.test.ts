import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { ulid } from 'ulidx';
import type { FastifyInstance } from 'fastify';
import type WebSocket from 'ws';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { hashDeviceCredential } from '../../src/device/credentials.js';
import type { Cancel, Clock } from '../../src/lib/clock.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { startTestPostgres, type TestPostgres } from '../helpers/postgres.js';

/**
 * `@fastify/websocket`'s `injectWS` synthesizes a socket-less request, which
 * crashes the app's trustProxy-driven request logger reading
 * `req.socket.remotePort` — see student/stream.test.ts. Test-harness-only.
 */
const INJECT_WS_UPGRADE_CONTEXT = { socket: { remoteAddress: '127.0.0.1', remotePort: 1 } };

interface ScheduledSleep {
  readonly dueAt: number;
  resolve: () => void;
}
interface ScheduledInterval {
  readonly periodMs: number;
  nextDueAt: number;
  readonly run: () => void;
  cancelled: boolean;
}

/** Deterministic Clock: time only moves on `advance()`, firing due sleeps/intervals in order (mirrors core-api's test double). */
class FakeClock implements Clock {
  #nowMs: number;
  #sleeps: ScheduledSleep[] = [];
  #intervals: ScheduledInterval[] = [];

  constructor(initial: Date = new Date('2026-01-01T00:00:00.000Z')) {
    this.#nowMs = initial.getTime();
  }

  now(): Date {
    return new Date(this.#nowMs);
  }

  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      const entry: ScheduledSleep = { dueAt: this.#nowMs + ms, resolve };
      this.#sleeps.push(entry);
      signal?.addEventListener(
        'abort',
        () => {
          const index = this.#sleeps.indexOf(entry);
          if (index !== -1) this.#sleeps.splice(index, 1);
          resolve();
        },
        { once: true },
      );
    });
  }

  every(ms: number, run: () => void): Cancel {
    const entry: ScheduledInterval = { periodMs: ms, nextDueAt: this.#nowMs + ms, run, cancelled: false };
    this.#intervals.push(entry);
    return { cancel: () => { entry.cancelled = true; } };
  }

  advance(ms: number): void {
    const target = this.#nowMs + ms;
    for (;;) {
      const dueSleep = this.#sleeps.reduce<ScheduledSleep | null>(
        (min, entry) => (min === null || entry.dueAt < min.dueAt ? entry : min),
        null,
      );
      const dueInterval = this.#intervals
        .filter((entry) => !entry.cancelled)
        .reduce<ScheduledInterval | null>(
          (min, entry) => (min === null || entry.nextDueAt < min.nextDueAt ? entry : min),
          null,
        );
      const candidates = [dueSleep?.dueAt, dueInterval?.nextDueAt].filter(
        (at): at is number => at !== undefined && at <= target,
      );
      if (candidates.length === 0) break;
      const dueAt = Math.min(...candidates);
      this.#nowMs = dueAt;
      if (dueSleep && dueSleep.dueAt === dueAt) {
        this.#sleeps.splice(this.#sleeps.indexOf(dueSleep), 1);
        dueSleep.resolve();
      }
      if (dueInterval && dueInterval.nextDueAt === dueAt) {
        dueInterval.nextDueAt += dueInterval.periodMs;
        dueInterval.run();
      }
    }
    this.#nowMs = target;
  }
}

interface Harness {
  app: FastifyInstance;
  clock: FakeClock;
  deviceId: string;
  deviceToken: string;
}

async function startHarness(pg: TestPostgres): Promise<Harness> {
  const config = loadConfig({ NODE_ENV: 'test', QUIZ_SERVICE_DATABASE_URL: pg.connectionString });
  const clock = new FakeClock();
  const app = await buildApp({ config, clock, ids: new UlidGenerator() });
  await app.ready();

  const deviceId = ulid();
  const deviceToken = `device-${randomUUID()}-bearer-token`;
  await app.sql`
    INSERT INTO devices (device_id, credential_hash, hall_display_name, enabled, created_at)
    VALUES (${deviceId}, ${await hashDeviceCredential(deviceToken)}, 'Hall A', true, now())
  `;

  return { app, clock, deviceId, deviceToken };
}

function deviceHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

async function seedQuizSession(harness: Harness, deviceId: string = harness.deviceId): Promise<string> {
  const id = ulid();
  const joinCode = `A${randomUUID().slice(0, 5).toUpperCase()}`;
  await harness.app.sql`
    INSERT INTO quiz_sessions (id, lecture_session_id, device_id, hall_display_name, join_code, join_url, state, opened_at, next_answer_seq)
    VALUES (${id}, ${ulid()}, ${deviceId}, 'Hall A', ${joinCode}, ${`https://quiz.example/j/${joinCode}`}, 'open', now(), 0)
  `;
  return id;
}

/** The device-stream wire schema validates `selectedOptionId` as a ULID (matching `zStudentQuizOption.id`), so fixture options must be ULID-shaped, not the bare "opt-a"/"opt-b" literals used by tests that never leave the database. */
const SEEDED_OPTION_A = ulid();
const SEEDED_OPTION_B = ulid();

async function seedPublication(harness: Harness, quizSessionId: string): Promise<string> {
  const publicationId = ulid();
  const options = JSON.stringify([
    { id: SEEDED_OPTION_A, label: 'A', text: 'A' },
    { id: SEEDED_OPTION_B, label: 'B', text: 'B' },
  ]);
  await harness.app.sql`
    INSERT INTO publications (id, quiz_session_id, question_id, prompt, options, correct_option_id, state, published_at)
    VALUES (${publicationId}, ${quizSessionId}, ${ulid()}, 'Q?', ${options}::jsonb, ${SEEDED_OPTION_A}, 'open', now())
  `;
  return publicationId;
}

let globalStudentCounter = 0;

/** Directly inserts a student+answer pair, bypassing the REST submission flow — replay/coalescing tests only care about the persisted rows. */
async function seedAnswer(harness: Harness, quizSessionId: string, publicationId: string, seq: number): Promise<void> {
  const studentId = ulid();
  globalStudentCounter += 1;
  const studentIdNumber = `ST${globalStudentCounter.toString().padStart(7, '0')}`;
  await harness.app.sql`
    INSERT INTO students (id, student_id_number, full_name, auth_method, created_at, last_seen_at)
    VALUES (${studentId}, ${studentIdNumber}, ${`Student ${seq}`}, 'self-registered', now(), now())
  `;
  await harness.app.sql`
    INSERT INTO answers (id, quiz_session_id, publication_id, student_id, selected_option_id, is_correct, points_awarded, response_time_ms, submitted_at, seq)
    VALUES (${ulid()}, ${quizSessionId}, ${publicationId}, ${studentId}, ${SEEDED_OPTION_A}, true, 10, 500, now(), ${seq})
  `;
}

async function registerParticipant(harness: Harness, quizSessionId: string, studentIdNumber: string): Promise<string> {
  const response = await harness.app.inject({
    method: 'POST',
    url: `/api/student/v1/quiz-sessions/${quizSessionId}/participants`,
    payload: { fullName: 'Test Student', studentIdNumber },
  });
  expect(response.statusCode).toBe(200);
  const cookie = response.cookies.find((c) => c.name === 'eduscope_participant');
  return `eduscope_participant=${cookie!.value}`;
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

async function publishViaDevice(harness: Harness, quizSessionId: string): Promise<{ publicationId: string; correctOptionId: string }> {
  const publicationId = ulid();
  const correctOptionId = ulid();
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
        { id: ulid(), label: 'B', text: 'Wrong' },
      ],
      correctOptionId,
      publishedAt: harness.clock.now().toISOString(),
    },
  });
  expect(response.statusCode).toBe(201);
  return { publicationId, correctOptionId };
}

async function connectDeviceStream(harness: Harness, token: string = harness.deviceToken): Promise<WebSocket> {
  return harness.app.injectWS('/api/device/v1/stream', { ...INJECT_WS_UPGRADE_CONTEXT, headers: deviceHeaders(token) } as never);
}

function sendHello(ws: WebSocket, deviceId: string, quizSessionId: string, answerWatermark = 0): void {
  ws.send(JSON.stringify({ type: 'sync.hello', deviceId, quizSessionId, answerWatermark }));
}

function collectFrames(ws: WebSocket): Array<{ type: string; [key: string]: unknown }> {
  const frames: Array<{ type: string; [key: string]: unknown }> = [];
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

function waitForClose(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    ws.once('close', (code: number, reasonBuf: Buffer) => resolve({ code, reason: reasonBuf.toString() }));
  });
}

describe('device realtime sync stream (events.md §4)', () => {
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

  it('rejects an upgrade with no bearer', async () => {
    harness = await startHarness(pg);
    await expect(harness.app.injectWS('/api/device/v1/stream', INJECT_WS_UPGRADE_CONTEXT as never)).rejects.toThrow(/401/);
  });

  it('rejects an upgrade with a wrong bearer', async () => {
    harness = await startHarness(pg);
    await expect(
      harness.app.injectWS('/api/device/v1/stream', { ...INJECT_WS_UPGRADE_CONTEXT, headers: deviceHeaders('not-a-real-token') } as never),
    ).rejects.toThrow(/401/);
  });

  it('rejects an upgrade for a disabled device', async () => {
    harness = await startHarness(pg);
    const disabledId = ulid();
    const disabledToken = `disabled-${randomUUID()}-bearer-token`;
    await harness.app.sql`
      INSERT INTO devices (device_id, credential_hash, hall_display_name, enabled, created_at)
      VALUES (${disabledId}, ${await hashDeviceCredential(disabledToken)}, 'Hall', false, now())
    `;
    await expect(
      harness.app.injectWS('/api/device/v1/stream', { ...INJECT_WS_UPGRADE_CONTEXT, headers: deviceHeaders(disabledToken) } as never),
    ).rejects.toThrow(/401/);
  });

  it('closes the socket when the first frame is not sync.hello', async () => {
    harness = await startHarness(pg);
    const ws = await connectDeviceStream(harness);
    const closed = waitForClose(ws);
    ws.send(JSON.stringify({ type: 'sync.heartbeat', at: new Date().toISOString() }));
    const { code } = await closed;
    expect(code).toBe(1008);
  });

  it('closes the socket on an invalid hello payload', async () => {
    harness = await startHarness(pg);
    const ws = await connectDeviceStream(harness);
    const closed = waitForClose(ws);
    ws.send(JSON.stringify({ type: 'sync.hello', deviceId: 'not-a-ulid', quizSessionId: 'also-not-a-ulid', answerWatermark: -1 }));
    const { code } = await closed;
    expect(code).toBe(1008);
  });

  it('closes the socket when hello.deviceId does not match the authenticated bearer', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);
    const ws = await connectDeviceStream(harness);
    const closed = waitForClose(ws);
    sendHello(ws, ulid(), quizSessionId);
    const { code } = await closed;
    expect(code).toBe(1008);
  });

  it('closes the socket when the quiz session belongs to a different device', async () => {
    harness = await startHarness(pg);
    const otherDeviceId = ulid();
    await harness.app.sql`
      INSERT INTO devices (device_id, credential_hash, hall_display_name, enabled, created_at)
      VALUES (${otherDeviceId}, ${await hashDeviceCredential('other-device-bearer-token-0123456789')}, 'Other Hall', true, now())
    `;
    const quizSessionId = await seedQuizSession(harness, otherDeviceId);
    const ws = await connectDeviceStream(harness);
    const closed = waitForClose(ws);
    sendHello(ws, harness.deviceId, quizSessionId);
    const { code } = await closed;
    expect(code).toBe(1008);
  });

  it('sends only a baseline sync.participants for a fresh session at watermark 0', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);
    const ws = await connectDeviceStream(harness);
    const frames = collectFrames(ws);
    sendHello(ws, harness.deviceId, quizSessionId);
    await waitFor(() => frames.length >= 1);
    await delay(30);

    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ type: 'sync.participants', quizSessionId, joinedCount: 0, onlineCount: 0 });
  });

  it('replays only answers above a mid-range watermark, in order', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);
    const publicationId = await seedPublication(harness, quizSessionId);
    for (let seq = 1; seq <= 5; seq += 1) await seedAnswer(harness, quizSessionId, publicationId, seq);

    const ws = await connectDeviceStream(harness);
    const frames = collectFrames(ws);
    sendHello(ws, harness.deviceId, quizSessionId, 2);
    await waitFor(() => frames.some((f) => f.type === 'sync.answers'));
    await delay(30);

    const answerFrames = frames.filter((f) => f.type === 'sync.answers') as unknown as Array<{
      answers: Array<{ seq: number }>;
    }>;
    expect(answerFrames).toHaveLength(1);
    expect(answerFrames[0]!.answers.map((a) => a.seq)).toEqual([3, 4, 5]);
  });

  it('replays nothing when the watermark is already at the max seq', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);
    const publicationId = await seedPublication(harness, quizSessionId);
    for (let seq = 1; seq <= 3; seq += 1) await seedAnswer(harness, quizSessionId, publicationId, seq);

    const ws = await connectDeviceStream(harness);
    const frames = collectFrames(ws);
    sendHello(ws, harness.deviceId, quizSessionId, 3);
    await waitFor(() => frames.length >= 1);
    await delay(30);

    expect(frames.filter((f) => f.type === 'sync.answers')).toHaveLength(0);
  });

  it('sends a server heartbeat every 5 seconds', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);
    const ws = await connectDeviceStream(harness);
    const frames = collectFrames(ws);
    sendHello(ws, harness.deviceId, quizSessionId);
    await waitFor(() => frames.length >= 1);

    harness.clock.advance(5_000);
    await waitFor(() => frames.some((f) => f.type === 'sync.heartbeat'));
    expect(frames.filter((f) => f.type === 'sync.heartbeat')).toHaveLength(1);

    harness.clock.advance(5_000);
    await waitFor(() => frames.filter((f) => f.type === 'sync.heartbeat').length >= 2);
  });

  it('closes a socket silent for more than 20 seconds', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);
    const ws = await connectDeviceStream(harness);
    const frames = collectFrames(ws);
    sendHello(ws, harness.deviceId, quizSessionId);
    await waitFor(() => frames.length >= 1);
    const closed = waitForClose(ws);

    harness.clock.advance(20_001);
    const { code } = await closed;
    expect(code).toBe(1008);
  });

  it('an inbound client heartbeat refreshes liveness and prevents the idle close', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);
    const ws = await connectDeviceStream(harness);
    const frames = collectFrames(ws);
    sendHello(ws, harness.deviceId, quizSessionId);
    await waitFor(() => frames.length >= 1);

    harness.clock.advance(15_000);
    ws.send(JSON.stringify({ type: 'sync.heartbeat', at: harness.clock.now().toISOString() }));
    await delay(30);
    harness.clock.advance(15_000); // 30s total wall time, but only 15s since the reset

    expect(ws.readyState).toBe(ws.OPEN);
  });

  it('a second connection supersedes the first, which cannot receive further live frames', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);

    const first = await connectDeviceStream(harness);
    const firstFrames = collectFrames(first);
    sendHello(first, harness.deviceId, quizSessionId);
    await waitFor(() => firstFrames.length >= 1);
    const firstClosed = waitForClose(first);

    const second = await connectDeviceStream(harness);
    const secondFrames = collectFrames(second);
    sendHello(second, harness.deviceId, quizSessionId);
    await waitFor(() => secondFrames.length >= 1);

    const closeEvent = await firstClosed;
    expect(closeEvent.code).toBe(4000);

    await registerParticipant(harness, quizSessionId, 'ST9999999');

    const firstCountBeforeFlush = firstFrames.length;
    harness.clock.advance(1_000);
    await waitFor(() => secondFrames.length > 1);
    await delay(30);

    expect(firstFrames.length).toBe(firstCountBeforeFlush);
  });

  it('coalesces multiple accepted answers into one sync.answers flush per second', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);
    const { publicationId, correctOptionId } = await publishViaDevice(harness, quizSessionId);

    const ws = await connectDeviceStream(harness);
    const frames = collectFrames(ws);
    sendHello(ws, harness.deviceId, quizSessionId);
    await waitFor(() => frames.length >= 1);
    const before = frames.length;

    const cookieA = await registerParticipant(harness, quizSessionId, 'ST0000001');
    const cookieB = await registerParticipant(harness, quizSessionId, 'ST0000002');
    await submitAnswer(harness, cookieA, publicationId, correctOptionId);
    await submitAnswer(harness, cookieB, publicationId, correctOptionId);

    harness.clock.advance(1_000);
    await waitFor(() => frames.length > before);
    await delay(30);

    const answerFrames = frames.slice(before).filter((f) => f.type === 'sync.answers') as unknown as Array<{
      answers: unknown[];
    }>;
    expect(answerFrames).toHaveLength(1);
    expect(answerFrames[0]!.answers).toHaveLength(2);
  });

  it('coalesces registration and connection changes into joined vs online counts', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);

    const ws = await connectDeviceStream(harness);
    const frames = collectFrames(ws);
    sendHello(ws, harness.deviceId, quizSessionId);
    await waitFor(() => frames.length >= 1);
    const before = frames.length;

    const cookieA = await registerParticipant(harness, quizSessionId, 'ST1000001');
    await registerParticipant(harness, quizSessionId, 'ST1000002');
    const studentWs = await harness.app.injectWS('/api/student/v1/stream', {
      ...INJECT_WS_UPGRADE_CONTEXT,
      headers: { cookie: cookieA },
    } as never);
    void studentWs;
    // `injectWS` resolves once the handshake completes, but `StudentStreamHub.attach`
    // (snapshot delivery, connection-state update, markParticipantCounts) runs
    // detached (`void hub.attach(...)`) — poll the row it writes rather than a fixed
    // delay, or the fake-clock advance below can fire its one flush tick before the
    // online transition (and the dirty flag it sets) actually lands.
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const [row] = await harness.app.sql<{ connection_state: string }[]>`
        SELECT p.connection_state FROM participants p
        JOIN students s ON s.id = p.student_id
        WHERE s.student_id_number = 'ST1000001' AND p.quiz_session_id = ${quizSessionId}
      `;
      if (row?.connection_state === 'online') break;
      await delay(10);
    }

    harness.clock.advance(1_000);
    await waitFor(() => frames.length > before);
    await delay(30);

    const participantFrames = frames.slice(before).filter((f) => f.type === 'sync.participants') as unknown as Array<{
      joinedCount: number;
      onlineCount: number;
    }>;
    expect(participantFrames.length).toBeGreaterThanOrEqual(1);
    const last = participantFrames[participantFrames.length - 1]!;
    expect(last.joinedCount).toBe(2);
    expect(last.onlineCount).toBe(1);
  });

  it('disconnect/reconnect replays exactly the missed answers with no gap or duplication', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);
    const publicationId = await seedPublication(harness, quizSessionId);
    for (let seq = 1; seq <= 2; seq += 1) await seedAnswer(harness, quizSessionId, publicationId, seq);

    const first = await connectDeviceStream(harness);
    const firstFrames = collectFrames(first);
    sendHello(first, harness.deviceId, quizSessionId, 0);
    await waitFor(() => firstFrames.length >= 1);
    first.close();
    await delay(30);

    for (let seq = 3; seq <= 207; seq += 1) await seedAnswer(harness, quizSessionId, publicationId, seq);

    const second = await connectDeviceStream(harness);
    const secondFrames = collectFrames(second);
    sendHello(second, harness.deviceId, quizSessionId, 2);
    await waitFor(() => secondFrames.filter((f) => f.type === 'sync.answers').length >= 2, 15_000);
    await delay(50);

    const answerFrames = secondFrames.filter((f) => f.type === 'sync.answers') as unknown as Array<{
      answers: Array<{ seq: number }>;
    }>;
    expect(answerFrames).toHaveLength(2);
    expect(answerFrames[0]!.answers.map((a) => a.seq)).toEqual(Array.from({ length: 200 }, (_, i) => i + 3));
    expect(answerFrames[1]!.answers.map((a) => a.seq)).toEqual(Array.from({ length: 5 }, (_, i) => i + 203));
  }, 30_000);
});
