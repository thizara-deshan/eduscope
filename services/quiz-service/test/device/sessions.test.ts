import { randomUUID } from 'node:crypto';
import { ulid } from 'ulidx';
import type { FastifyInstance } from 'fastify';
import { zQuizSessionCreateResponse } from '@eduscope/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import type { JoinCodeGenerator } from '../../src/device/session-routes.js';
import { hashDeviceCredential } from '../../src/device/credentials.js';
import { SystemClock } from '../../src/lib/clock.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { startTestPostgres, type TestPostgres } from '../helpers/postgres.js';

class SequenceJoinCodeGenerator implements JoinCodeGenerator {
  #codes: string[];
  constructor(codes: string[]) {
    this.#codes = [...codes];
  }
  next(): string {
    const code = this.#codes.shift();
    if (code === undefined) throw new Error('SequenceJoinCodeGenerator exhausted');
    return code;
  }
}

interface Harness {
  app: FastifyInstance;
  deviceAId: string;
  deviceAToken: string;
  deviceBId: string;
  deviceBToken: string;
}

// Each harness mints its own bearer tokens so device rows from earlier
// harnesses sharing the same Postgres container never collide on token
// value — `authenticateDevice` matches by trying every enabled device's
// hash, so two devices sharing a plaintext token would be ambiguous.
async function startHarness(pg: TestPostgres, joinCodeGenerator?: JoinCodeGenerator): Promise<Harness> {
  const config = loadConfig({ NODE_ENV: 'test', QUIZ_SERVICE_DATABASE_URL: pg.connectionString });
  const app = await buildApp({
    config,
    clock: new SystemClock(),
    ids: new UlidGenerator(),
    ...(joinCodeGenerator ? { joinCodeGenerator } : {}),
  });

  const deviceAId = ulid();
  const deviceBId = ulid();
  const deviceAToken = `device-a-${randomUUID()}-bearer-token`;
  const deviceBToken = `device-b-${randomUUID()}-bearer-token`;
  await app.sql`
    INSERT INTO devices (device_id, credential_hash, hall_display_name, enabled, created_at)
    VALUES (${deviceAId}, ${await hashDeviceCredential(deviceAToken)}, 'Hall A', true, now())
  `;
  await app.sql`
    INSERT INTO devices (device_id, credential_hash, hall_display_name, enabled, created_at)
    VALUES (${deviceBId}, ${await hashDeviceCredential(deviceBToken)}, 'Hall B', true, now())
  `;

  return { app, deviceAId, deviceAToken, deviceBId, deviceBToken };
}

function createHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

describe('device quiz-session sync REST', () => {
  let pg: TestPostgres;
  let harness: Harness | undefined;

  beforeAll(async () => {
    pg = await startTestPostgres();
  }, 60_000);

  afterEach(async () => {
    await harness?.app.close();
    harness = undefined;
  });

  afterAll(async () => {
    await pg?.stop();
  });

  it('creates a session and returns the contracted 201 shape', async () => {
    harness = await startHarness(pg, new SequenceJoinCodeGenerator(['ABCDEF']));
    const lectureSessionId = ulid();
    const response = await harness.app.inject({
      method: 'POST',
      url: '/device/v1/quiz-sessions',
      headers: createHeaders(harness.deviceAToken),
      payload: { lectureSessionId, deviceId: harness.deviceAId, hallDisplayName: 'Lecture Hall 1' },
    });
    expect(response.statusCode).toBe(201);
    const body = zQuizSessionCreateResponse.parse(response.json());
    expect(body).toMatchObject({
      lectureSessionId,
      state: 'open',
      joinCode: 'ABCDEF',
    });
    expect(body.joinUrl).toBe('http://127.0.0.1:7300/j/ABCDEF');
  });

  it('rejects a body whose deviceId does not match the authenticated bearer', async () => {
    harness = await startHarness(pg, new SequenceJoinCodeGenerator(['AAAAAA']));
    const response = await harness.app.inject({
      method: 'POST',
      url: '/device/v1/quiz-sessions',
      headers: createHeaders(harness.deviceAToken),
      payload: { lectureSessionId: ulid(), deviceId: harness.deviceBId, hallDisplayName: 'Hall' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects a malformed body with 422 validation.invalid', async () => {
    harness = await startHarness(pg, new SequenceJoinCodeGenerator(['AAAAAA']));
    const response = await harness.app.inject({
      method: 'POST',
      url: '/device/v1/quiz-sessions',
      headers: createHeaders(harness.deviceAToken),
      payload: { lectureSessionId: ulid(), deviceId: harness.deviceAId },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ status: 422, code: 'validation.invalid' });
  });

  it('is idempotent on lectureSessionId for the same device', async () => {
    harness = await startHarness(pg, new SequenceJoinCodeGenerator(['BBBBBB', 'CCCCCC']));
    const lectureSessionId = ulid();
    const payload = { lectureSessionId, deviceId: harness.deviceAId, hallDisplayName: 'Hall' };

    const first = await harness.app.inject({
      method: 'POST',
      url: '/device/v1/quiz-sessions',
      headers: createHeaders(harness.deviceAToken),
      payload,
    });
    const second = await harness.app.inject({
      method: 'POST',
      url: '/device/v1/quiz-sessions',
      headers: createHeaders(harness.deviceAToken),
      payload,
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());
  });

  it('two concurrent same-lecture creates from the same device converge on one session', async () => {
    harness = await startHarness(pg, new SequenceJoinCodeGenerator(['DDDDDD', 'EEEEEE']));
    const lectureSessionId = ulid();
    const payload = { lectureSessionId, deviceId: harness.deviceAId, hallDisplayName: 'Hall' };

    const [first, second] = await Promise.all([
      harness.app.inject({ method: 'POST', url: '/device/v1/quiz-sessions', headers: createHeaders(harness.deviceAToken), payload }),
      harness.app.inject({ method: 'POST', url: '/device/v1/quiz-sessions', headers: createHeaders(harness.deviceAToken), payload }),
    ]);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(first.json()).toEqual(second.json());
  });

  it('retries join-code generation on collision and consumes the next candidate', async () => {
    harness = await startHarness(pg, new SequenceJoinCodeGenerator(['FIXEDX']));
    await harness.app.inject({
      method: 'POST',
      url: '/device/v1/quiz-sessions',
      headers: createHeaders(harness.deviceAToken),
      payload: { lectureSessionId: ulid(), deviceId: harness.deviceAId, hallDisplayName: 'Hall' },
    });
    await harness.app.close();

    harness = await startHarness(pg, new SequenceJoinCodeGenerator(['FIXEDX', 'FRESHY']));
    const response = await harness.app.inject({
      method: 'POST',
      url: '/device/v1/quiz-sessions',
      headers: createHeaders(harness.deviceBToken),
      payload: { lectureSessionId: ulid(), deviceId: harness.deviceBId, hallDisplayName: 'Hall' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ joinCode: 'FRESHY' });
  });

  it('returns 409 conflict when a different device already holds an open session for the lecture', async () => {
    harness = await startHarness(pg, new SequenceJoinCodeGenerator(['GGGGGG', 'HHHHHH']));
    const lectureSessionId = ulid();

    const first = await harness.app.inject({
      method: 'POST',
      url: '/device/v1/quiz-sessions',
      headers: createHeaders(harness.deviceAToken),
      payload: { lectureSessionId, deviceId: harness.deviceAId, hallDisplayName: 'Hall' },
    });
    expect(first.statusCode).toBe(201);

    const second = await harness.app.inject({
      method: 'POST',
      url: '/device/v1/quiz-sessions',
      headers: createHeaders(harness.deviceBToken),
      payload: { lectureSessionId, deviceId: harness.deviceBId, hallDisplayName: 'Hall' },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ status: 409, code: 'conflict' });
  });

  it('closes an open session and closes its open publication with session-ended', async () => {
    harness = await startHarness(pg, new SequenceJoinCodeGenerator(['IIIIII']));
    const created = await harness.app.inject({
      method: 'POST',
      url: '/device/v1/quiz-sessions',
      headers: createHeaders(harness.deviceAToken),
      payload: { lectureSessionId: ulid(), deviceId: harness.deviceAId, hallDisplayName: 'Hall' },
    });
    const { id: quizSessionId } = created.json() as { id: string };

    const publicationId = randomUUID();
    const options = JSON.stringify([
      { id: 'opt-a', label: 'A', text: 'A' },
      { id: 'opt-b', label: 'B', text: 'B' },
    ]);
    await harness.app.sql`
      INSERT INTO publications (id, quiz_session_id, question_id, prompt, options, correct_option_id, state, published_at)
      VALUES (${publicationId}, ${quizSessionId}, ${randomUUID()}, 'Prompt?', ${options}::jsonb, 'opt-a', 'open', now())
    `;

    const response = await harness.app.inject({
      method: 'POST',
      url: `/device/v1/quiz-sessions/${quizSessionId}/close`,
      headers: createHeaders(harness.deviceAToken),
    });
    expect(response.statusCode).toBe(204);

    const [sessionRow] = await harness.app.sql`SELECT state, closed_at FROM quiz_sessions WHERE id = ${quizSessionId}`;
    expect(sessionRow?.state).toBe('closed');
    expect(sessionRow?.closed_at).not.toBeNull();

    const [publicationRow] = await harness.app.sql`SELECT state, close_reason FROM publications WHERE id = ${publicationId}`;
    expect(publicationRow?.state).toBe('closed');
    expect(publicationRow?.close_reason).toBe('session-ended');
  });

  it('repeated close is idempotent and preserves the original closed_at', async () => {
    harness = await startHarness(pg, new SequenceJoinCodeGenerator(['JJJJJJ']));
    const created = await harness.app.inject({
      method: 'POST',
      url: '/device/v1/quiz-sessions',
      headers: createHeaders(harness.deviceAToken),
      payload: { lectureSessionId: ulid(), deviceId: harness.deviceAId, hallDisplayName: 'Hall' },
    });
    const { id: quizSessionId } = created.json() as { id: string };

    const first = await harness.app.inject({
      method: 'POST',
      url: `/device/v1/quiz-sessions/${quizSessionId}/close`,
      headers: createHeaders(harness.deviceAToken),
    });
    expect(first.statusCode).toBe(204);
    const [afterFirst] = await harness.app.sql`SELECT closed_at FROM quiz_sessions WHERE id = ${quizSessionId}`;

    const second = await harness.app.inject({
      method: 'POST',
      url: `/device/v1/quiz-sessions/${quizSessionId}/close`,
      headers: createHeaders(harness.deviceAToken),
    });
    expect(second.statusCode).toBe(204);
    const [afterSecond] = await harness.app.sql`SELECT closed_at FROM quiz_sessions WHERE id = ${quizSessionId}`;

    expect(afterSecond?.closed_at).toEqual(afterFirst?.closed_at);
  });

  it('closing another device session is a no-op 204 that leaves the session open', async () => {
    harness = await startHarness(pg, new SequenceJoinCodeGenerator(['KKKKKK']));
    const created = await harness.app.inject({
      method: 'POST',
      url: '/device/v1/quiz-sessions',
      headers: createHeaders(harness.deviceAToken),
      payload: { lectureSessionId: ulid(), deviceId: harness.deviceAId, hallDisplayName: 'Hall' },
    });
    const { id: quizSessionId } = created.json() as { id: string };

    const response = await harness.app.inject({
      method: 'POST',
      url: `/device/v1/quiz-sessions/${quizSessionId}/close`,
      headers: createHeaders(harness.deviceBToken),
    });
    expect(response.statusCode).toBe(204);

    const [sessionRow] = await harness.app.sql`SELECT state FROM quiz_sessions WHERE id = ${quizSessionId}`;
    expect(sessionRow?.state).toBe('open');
  });
});
