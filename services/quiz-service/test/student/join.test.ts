import { randomUUID } from 'node:crypto';
import { ulid } from 'ulidx';
import type { FastifyInstance } from 'fastify';
import { zQuizAppProblem, zResolveJoinCodeResponse } from '@eduscope/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { hashDeviceCredential } from '../../src/device/credentials.js';
import { hashParticipantToken } from '../../src/student/cookies.js';
import { SystemClock } from '../../src/lib/clock.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { startTestPostgres, type TestPostgres } from '../helpers/postgres.js';

interface Harness {
  app: FastifyInstance;
  deviceId: string;
}

async function startHarness(pg: TestPostgres): Promise<Harness> {
  const config = loadConfig({ NODE_ENV: 'test', QUIZ_SERVICE_DATABASE_URL: pg.connectionString });
  const app = await buildApp({ config, clock: new SystemClock(), ids: new UlidGenerator() });

  const deviceId = ulid();
  await app.sql`
    INSERT INTO devices (device_id, credential_hash, hall_display_name, enabled, created_at)
    VALUES (${deviceId}, ${await hashDeviceCredential(`join-device-${randomUUID()}-bearer-token`)}, 'Hall J', true, now())
  `;

  return { app, deviceId };
}

interface SeedSessionOptions {
  state?: 'open' | 'closed';
  joinCode?: string;
}

async function seedQuizSession(harness: Harness, options: SeedSessionOptions = {}): Promise<{ id: string; joinCode: string }> {
  const id = ulid();
  const joinCode = options.joinCode ?? `J${randomUUID().slice(0, 5).toUpperCase()}`;
  const state = options.state ?? 'open';
  await harness.app.sql`
    INSERT INTO quiz_sessions
      (id, lecture_session_id, device_id, hall_display_name, join_code, join_url, state, opened_at, closed_at, next_answer_seq)
    VALUES
      (${id}, ${ulid()}, ${harness.deviceId}, 'Hall J', ${joinCode},
       ${`https://quiz.example/j/${joinCode}`}, ${state}, now(),
       ${state === 'closed' ? new Date().toISOString() : null}, 0)
  `;
  return { id, joinCode };
}

function randomStudentId(): string {
  return `AB${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
}

interface SeedParticipantOptions {
  expiresAt?: Date;
}

async function seedParticipantSession(
  harness: Harness,
  quizSessionId: string,
  options: SeedParticipantOptions = {},
): Promise<{ token: string }> {
  const studentId = ulid();
  const participantId = ulid();
  const token = randomUUID().replace(/-/g, '');
  const expiresAt = options.expiresAt ?? new Date(Date.now() + 3_600_000);

  await harness.app.sql`
    INSERT INTO students (id, student_id_number, full_name, auth_method, created_at, last_seen_at)
    VALUES (${studentId}, ${randomStudentId()}, 'Existing Student', 'self-registered', now(), now())
  `;
  await harness.app.sql`
    INSERT INTO participants (id, quiz_session_id, student_id, joined_at, last_seen_at, connection_state)
    VALUES (${participantId}, ${quizSessionId}, ${studentId}, now(), now(), 'offline')
  `;
  await harness.app.sql`
    INSERT INTO participant_sessions (token_hash, participant_id, student_id, issued_at, expires_at)
    VALUES (${hashParticipantToken(token)}, ${participantId}, ${studentId}, now(), ${expiresAt.toISOString()})
  `;

  return { token };
}

describe('student join resolution (resolveJoinCode)', () => {
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

  it('resolves an open session case-insensitively as anonymous', async () => {
    harness = await startHarness(pg);
    const { id, joinCode } = await seedQuizSession(harness);

    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/student/v1/join-codes/${joinCode.toLowerCase()}`,
    });

    expect(response.statusCode).toBe(200);
    const body = zResolveJoinCodeResponse.parse(response.json());
    expect(body.quizSessionId).toBe(id);
    expect(body.state).toBe('open');
    expect(body.participantState).toBe('anonymous');
    expect(body.registrationPolicy).toEqual({
      studentIdPattern: '^[A-Z]{2}[0-9]{7,8}$',
      studentIdHint: 'Two uppercase letters followed by 7 or 8 digits',
      inputMode: 'text',
      studentIdMaxLength: 10,
      fullNameMaxLength: 128,
    });
  });

  it('resolves a closed session with state closed', async () => {
    harness = await startHarness(pg);
    const { joinCode } = await seedQuizSession(harness, { state: 'closed' });

    const response = await harness.app.inject({ method: 'GET', url: `/api/student/v1/join-codes/${joinCode}` });

    expect(response.statusCode).toBe(200);
    expect(zResolveJoinCodeResponse.parse(response.json()).state).toBe('closed');
  });

  it('returns quiz.session-not-found for an unknown code', async () => {
    harness = await startHarness(pg);

    const response = await harness.app.inject({ method: 'GET', url: '/api/student/v1/join-codes/ZZZZZZ' });

    expect(response.statusCode).toBe(404);
    expect(zQuizAppProblem.parse(response.json()).code).toBe('quiz.session-not-found');
  });

  it('reports returning participantState only for a cookie scoped to the resolved session', async () => {
    harness = await startHarness(pg);
    const { id, joinCode } = await seedQuizSession(harness);
    const { token } = await seedParticipantSession(harness, id);

    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/student/v1/join-codes/${joinCode}`,
      headers: { cookie: `eduscope_participant=${token}` },
    });

    expect(zResolveJoinCodeResponse.parse(response.json()).participantState).toBe('returning');
  });

  it('reports anonymous participantState for a cookie scoped to a different session', async () => {
    harness = await startHarness(pg);
    const other = await seedQuizSession(harness);
    const { token } = await seedParticipantSession(harness, other.id);
    const { joinCode } = await seedQuizSession(harness);

    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/student/v1/join-codes/${joinCode}`,
      headers: { cookie: `eduscope_participant=${token}` },
    });

    expect(zResolveJoinCodeResponse.parse(response.json()).participantState).toBe('anonymous');
  });

  it('treats an expired cookie as anonymous', async () => {
    harness = await startHarness(pg);
    const { id, joinCode } = await seedQuizSession(harness);
    const { token } = await seedParticipantSession(harness, id, { expiresAt: new Date(Date.now() - 1_000) });

    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/student/v1/join-codes/${joinCode}`,
      headers: { cookie: `eduscope_participant=${token}` },
    });

    expect(zResolveJoinCodeResponse.parse(response.json()).participantState).toBe('anonymous');
  });

  it('treats a tampered/unknown cookie value as anonymous', async () => {
    harness = await startHarness(pg);
    const { joinCode } = await seedQuizSession(harness);

    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/student/v1/join-codes/${joinCode}`,
      headers: { cookie: 'eduscope_participant=not-a-real-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(zResolveJoinCodeResponse.parse(response.json()).participantState).toBe('anonymous');
  });

  it('makes zero inserts or updates while resolving', async () => {
    harness = await startHarness(pg);
    const { joinCode } = await seedQuizSession(harness);

    const [before] = await harness.app.sql`SELECT count(*)::int AS count FROM students`;
    await harness.app.inject({ method: 'GET', url: `/api/student/v1/join-codes/${joinCode}` });
    await harness.app.inject({ method: 'GET', url: `/api/student/v1/join-codes/${joinCode}` });
    const [after] = await harness.app.sql`SELECT count(*)::int AS count FROM students`;

    expect(after!.count).toBe(before!.count);
  });

  it('rate limits resolution to 10 requests per minute per IP with quiz.unavailable', async () => {
    harness = await startHarness(pg);
    const { joinCode } = await seedQuizSession(harness);

    let last;
    for (let i = 0; i < 11; i += 1) {
      last = await harness.app.inject({ method: 'GET', url: `/api/student/v1/join-codes/${joinCode}` });
    }

    expect(last?.statusCode).toBe(503);
    expect(zQuizAppProblem.parse(last?.json()).code).toBe('quiz.unavailable');
  });
});
