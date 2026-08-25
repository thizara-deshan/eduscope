import { randomUUID } from 'node:crypto';
import { ulid } from 'ulidx';
import type { FastifyInstance } from 'fastify';
import { zQuizAppProblem, zRegisterParticipantResponse } from '@eduscope/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { hashDeviceCredential } from '../../src/device/credentials.js';
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
    VALUES (${deviceId}, ${await hashDeviceCredential(`reg-device-${randomUUID()}-bearer-token`)}, 'Hall R', true, now())
  `;

  return { app, deviceId };
}

interface SeedSessionOptions {
  state?: 'open' | 'closed';
}

async function seedQuizSession(harness: Harness, options: SeedSessionOptions = {}): Promise<string> {
  const id = ulid();
  const joinCode = `R${randomUUID().slice(0, 5).toUpperCase()}`;
  const state = options.state ?? 'open';
  await harness.app.sql`
    INSERT INTO quiz_sessions
      (id, lecture_session_id, device_id, hall_display_name, join_code, join_url, state, opened_at, closed_at, next_answer_seq)
    VALUES
      (${id}, ${ulid()}, ${harness.deviceId}, 'Hall R', ${joinCode},
       ${`https://quiz.example/j/${joinCode}`}, ${state}, now(),
       ${state === 'closed' ? new Date().toISOString() : null}, 0)
  `;
  return id;
}

// A counter, not `Math.random()`, guarantees no collision across the up to
// 1000 ids a single capacity test draws in one batch (birthday-paradox risk
// at that volume against a ~9M-value random range is non-negligible).
let studentIdCounter = 0;
function randomStudentId(): string {
  studentIdCounter += 1;
  return `AB${studentIdCounter.toString().padStart(7, '0')}`;
}

function participantsUrl(quizSessionId: string): string {
  return `/api/student/v1/quiz-sessions/${quizSessionId}/participants`;
}

async function seedParticipants(harness: Harness, quizSessionId: string, count: number): Promise<void> {
  const now = new Date().toISOString();
  const studentRows = Array.from({ length: count }, () => ({
    id: ulid(),
    student_id_number: randomStudentId(),
    full_name: 'Seed Student',
    auth_method: 'self-registered',
    created_at: now,
    last_seen_at: now,
  }));
  await harness.app.sql`INSERT INTO students ${harness.app.sql(studentRows)}`;

  const participantRows = studentRows.map((student) => ({
    id: ulid(),
    quiz_session_id: quizSessionId,
    student_id: student.id,
    joined_at: now,
    last_seen_at: now,
    connection_state: 'offline',
  }));
  await harness.app.sql`INSERT INTO participants ${harness.app.sql(participantRows)}`;
}

describe('student participant registration (registerParticipant)', () => {
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

  it('creates a new participant and sets the contracted cookie', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);

    const response = await harness.app.inject({
      method: 'POST',
      url: participantsUrl(quizSessionId),
      payload: { fullName: 'Ada Lovelace', studentIdNumber: randomStudentId() },
    });

    expect(response.statusCode).toBe(200);
    const body = zRegisterParticipantResponse.parse(response.json());
    expect(body.outcome).toBe('created');
    expect(body.quizSessionId).toBe(quizSessionId);

    const cookie = response.cookies.find((c) => c.name === 'eduscope_participant');
    expect(cookie).toBeDefined();
    expect(cookie?.secure).toBe(true);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('Lax');
    expect(cookie?.path).toBe('/api/student/v1');
  });

  it('rejoins the same participant and updates only that student\'s display name', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);
    const studentIdNumber = randomStudentId();

    const first = await harness.app.inject({
      method: 'POST',
      url: participantsUrl(quizSessionId),
      payload: { fullName: 'Original Name', studentIdNumber },
    });
    const firstBody = zRegisterParticipantResponse.parse(first.json());

    const second = await harness.app.inject({
      method: 'POST',
      url: participantsUrl(quizSessionId),
      payload: { fullName: 'Updated Name', studentIdNumber },
    });
    const secondBody = zRegisterParticipantResponse.parse(second.json());

    expect(secondBody.outcome).toBe('rejoined');
    expect(secondBody.participantId).toBe(firstBody.participantId);

    const [row] = await harness.app.sql`SELECT full_name FROM students WHERE student_id_number=${studentIdNumber}`;
    expect(row!.full_name).toBe('Updated Name');

    const [countRow] = await harness.app
      .sql`SELECT count(*)::int AS count FROM participants WHERE quiz_session_id=${quizSessionId}`;
    expect(countRow!.count).toBe(1);
  });

  it('rejects registration on a closed session with quiz.session-closed', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness, { state: 'closed' });

    const response = await harness.app.inject({
      method: 'POST',
      url: participantsUrl(quizSessionId),
      payload: { fullName: 'Ada Lovelace', studentIdNumber: randomStudentId() },
    });

    expect(response.statusCode).toBe(409);
    expect(zQuizAppProblem.parse(response.json()).code).toBe('quiz.session-closed');
  });

  it('rejects registration on an unknown session with quiz.unavailable', async () => {
    harness = await startHarness(pg);

    const response = await harness.app.inject({
      method: 'POST',
      url: participantsUrl(ulid()),
      payload: { fullName: 'Ada Lovelace', studentIdNumber: randomStudentId() },
    });

    expect(response.statusCode).toBe(503);
    expect(zQuizAppProblem.parse(response.json()).code).toBe('quiz.unavailable');
  });

  it('rejects a blank/whitespace full name with registration.invalid-name and the /fullName pointer', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);

    const response = await harness.app.inject({
      method: 'POST',
      url: participantsUrl(quizSessionId),
      payload: { fullName: '   ', studentIdNumber: randomStudentId() },
    });

    expect(response.statusCode).toBe(422);
    const body = zQuizAppProblem.parse(response.json());
    expect(body.code).toBe('registration.invalid-name');
    expect(body.fieldViolations?.[0]?.pointer).toBe('/fullName');
  });

  it('rejects a malformed/lowercase student id with registration.invalid-student-id and the /studentIdNumber pointer', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);

    const response = await harness.app.inject({
      method: 'POST',
      url: participantsUrl(quizSessionId),
      payload: { fullName: 'Ada Lovelace', studentIdNumber: 'ab1234567' },
    });

    expect(response.statusCode).toBe(422);
    const body = zQuizAppProblem.parse(response.json());
    expect(body.code).toBe('registration.invalid-student-id');
    expect(body.fieldViolations?.[0]?.pointer).toBe('/studentIdNumber');
  });

  it('accepts a 9-character and a 10-character student id', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);

    for (const studentIdNumber of ['AB1234567', 'AB12345678']) {
      const response = await harness.app.inject({
        method: 'POST',
        url: participantsUrl(quizSessionId),
        payload: { fullName: 'Ada Lovelace', studentIdNumber },
      });
      expect(response.statusCode).toBe(200);
    }
  });

  it('rejects a new participant once the session holds 1000 participants', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);
    await seedParticipants(harness, quizSessionId, 1000);

    const response = await harness.app.inject({
      method: 'POST',
      url: participantsUrl(quizSessionId),
      payload: { fullName: 'Latecomer', studentIdNumber: randomStudentId() },
    });

    expect(response.statusCode).toBe(503);
    expect(zQuizAppProblem.parse(response.json()).code).toBe('quiz.unavailable');
  }, 30_000);

  it('still allows an already-registered participant to rejoin once the session is at capacity', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);
    const studentIdNumber = randomStudentId();

    const first = await harness.app.inject({
      method: 'POST',
      url: participantsUrl(quizSessionId),
      payload: { fullName: 'Early Bird', studentIdNumber },
    });
    const firstBody = zRegisterParticipantResponse.parse(first.json());

    await seedParticipants(harness, quizSessionId, 999);

    const rejoin = await harness.app.inject({
      method: 'POST',
      url: participantsUrl(quizSessionId),
      payload: { fullName: 'Early Bird Returns', studentIdNumber },
    });

    expect(rejoin.statusCode).toBe(200);
    const rejoinBody = zRegisterParticipantResponse.parse(rejoin.json());
    expect(rejoinBody.outcome).toBe('rejoined');
    expect(rejoinBody.participantId).toBe(firstBody.participantId);
  }, 30_000);

  it('resolves concurrent duplicate registrations to one created and one rejoined outcome', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);
    const studentIdNumber = randomStudentId();

    const [first, second] = await Promise.all([
      harness.app.inject({
        method: 'POST',
        url: participantsUrl(quizSessionId),
        payload: { fullName: 'Racer One', studentIdNumber },
      }),
      harness.app.inject({
        method: 'POST',
        url: participantsUrl(quizSessionId),
        payload: { fullName: 'Racer Two', studentIdNumber },
      }),
    ]);

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);

    const firstBody = zRegisterParticipantResponse.parse(first.json());
    const secondBody = zRegisterParticipantResponse.parse(second.json());

    expect([firstBody.outcome, secondBody.outcome].sort()).toEqual(['created', 'rejoined']);
    expect(firstBody.participantId).toBe(secondBody.participantId);

    const [countRow] = await harness.app
      .sql`SELECT count(*)::int AS count FROM participants WHERE quiz_session_id=${quizSessionId}`;
    expect(countRow!.count).toBe(1);
  });

  it('rate limits registration to 5 requests per minute per IP with quiz.unavailable', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);

    let last;
    for (let i = 0; i < 6; i += 1) {
      last = await harness.app.inject({
        method: 'POST',
        url: participantsUrl(quizSessionId),
        payload: { fullName: `Student ${i}`, studentIdNumber: randomStudentId() },
      });
    }

    expect(last?.statusCode).toBe(503);
    expect(zQuizAppProblem.parse(last?.json()).code).toBe('quiz.unavailable');
  });
});
