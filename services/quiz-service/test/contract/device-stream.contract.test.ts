import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { ulid } from 'ulidx';
import type { FastifyInstance } from 'fastify';
import type WebSocket from 'ws';
import { zQuizSyncClientMessage, zQuizSyncServerMessage } from '@eduscope/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { hashDeviceCredential } from '../../src/device/credentials.js';
import { SystemClock } from '../../src/lib/clock.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { startTestPostgres, type TestPostgres } from '../helpers/postgres.js';

/** See test/device/stream.test.ts — `injectWS` bypasses `.socket`, which the trustProxy-driven request logger needs. */
const INJECT_WS_UPGRADE_CONTEXT = { socket: { remoteAddress: '127.0.0.1', remotePort: 1 } };

function deviceHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

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

describe('device realtime sync contract (events.md §4 — D-owned server directions)', () => {
  let pg: TestPostgres;
  let app: FastifyInstance;
  let deviceId: string;
  let deviceToken: string;
  let quizSessionId: string;

  beforeAll(async () => {
    pg = await startTestPostgres();
    const config = loadConfig({ NODE_ENV: 'test', QUIZ_SERVICE_DATABASE_URL: pg.connectionString });
    app = await buildApp({ config, clock: new SystemClock(), ids: new UlidGenerator() });
    // See test/device/stream.test.ts — `injectWS` bypasses the usual `app.ready()` bootstrap.
    await app.ready();

    deviceId = ulid();
    deviceToken = `contract-device-${randomUUID()}-bearer-token`;
    await app.sql`
      INSERT INTO devices (device_id, credential_hash, hall_display_name, enabled, created_at)
      VALUES (${deviceId}, ${await hashDeviceCredential(deviceToken)}, 'Contract Hall', true, now())
    `;

    quizSessionId = ulid();
    const joinCode = `F${randomUUID().slice(0, 5).toUpperCase()}`;
    await app.sql`
      INSERT INTO quiz_sessions (id, lecture_session_id, device_id, hall_display_name, join_code, join_url, state, opened_at, next_answer_seq)
      VALUES (${quizSessionId}, ${ulid()}, ${deviceId}, 'Contract Hall', ${joinCode}, ${`https://quiz.example/j/${joinCode}`}, 'open', now(), 0)
    `;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  it('captures a hello + baseline flow and every frame parses as zQuizSyncServerMessage', async () => {
    const ws = await app.injectWS('/api/device/v1/stream', { ...INJECT_WS_UPGRADE_CONTEXT, headers: deviceHeaders(deviceToken) } as never);
    const frames = collectFrames(ws);
    ws.send(JSON.stringify({ type: 'sync.hello', deviceId, quizSessionId, answerWatermark: 0 }));
    await waitFor(() => frames.length >= 1);
    await delay(30);

    expect(frames.length).toBeGreaterThanOrEqual(1);
    for (const frame of frames) {
      const parsed = zQuizSyncServerMessage.parse(frame);
      expect(['sync.answers', 'sync.participants', 'sync.heartbeat']).toContain(parsed.type);
    }
    ws.close();
  });

  it('declares exactly the three D-owned server message type names in the shared discriminated union', () => {
    const members = new Set(zQuizSyncServerMessage.options.map((option) => option.shape.type.value as string));
    expect([...members].sort()).toEqual(['sync.answers', 'sync.heartbeat', 'sync.participants']);
  });

  it('parses a B-shaped sync.hello and sync.heartbeat client frame unchanged (the only B-owned client messages)', () => {
    const hello = { type: 'sync.hello' as const, deviceId, quizSessionId, answerWatermark: 0 };
    const heartbeat = { type: 'sync.heartbeat' as const, at: new Date().toISOString() };
    expect(() => zQuizSyncClientMessage.parse(hello)).not.toThrow();
    expect(() => zQuizSyncClientMessage.parse(heartbeat)).not.toThrow();
  });

  it('a sync.answers fixture never carries pointsAwarded or any field outside the declared schema', async () => {
    const publicationId = ulid();
    const optionA = ulid();
    const optionB = ulid();
    const options = JSON.stringify([
      { id: optionA, label: 'A', text: 'A' },
      { id: optionB, label: 'B', text: 'B' },
    ]);
    await app.sql`
      INSERT INTO publications (id, quiz_session_id, question_id, prompt, options, correct_option_id, state, published_at)
      VALUES (${publicationId}, ${quizSessionId}, ${ulid()}, 'Q?', ${options}::jsonb, ${optionA}, 'open', now())
    `;
    const studentId = ulid();
    await app.sql`
      INSERT INTO students (id, student_id_number, full_name, auth_method, created_at, last_seen_at)
      VALUES (${studentId}, 'CT1234567', 'Contract Student', 'self-registered', now(), now())
    `;
    await app.sql`
      INSERT INTO answers (id, quiz_session_id, publication_id, student_id, selected_option_id, is_correct, points_awarded, response_time_ms, submitted_at, seq)
      VALUES (${ulid()}, ${quizSessionId}, ${publicationId}, ${studentId}, ${optionA}, true, 10, 500, now(), 1)
    `;

    const ws = await app.injectWS('/api/device/v1/stream', { ...INJECT_WS_UPGRADE_CONTEXT, headers: deviceHeaders(deviceToken) } as never);
    const frames = collectFrames(ws);
    ws.send(JSON.stringify({ type: 'sync.hello', deviceId, quizSessionId, answerWatermark: 0 }));
    await waitFor(() => frames.some((f) => (f as { type: string }).type === 'sync.answers'));
    await delay(30);

    const answerFrame = frames.find((f) => (f as { type: string }).type === 'sync.answers')!;
    zQuizSyncServerMessage.parse(answerFrame);
    expect(JSON.stringify(answerFrame)).not.toContain('pointsAwarded');
    ws.close();
  });
});
