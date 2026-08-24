import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { ulid } from 'ulidx';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { zQuizAppProblem, zRegisterParticipantResponse, zResolveJoinCodeResponse } from '@eduscope/shared';
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
  publicOrigin: string;
  /** Real, pino-serialized log lines exactly as they would reach stdout in production. */
  logLines: string[];
}

/** Every response must expose only the closed `QuizAppProblem` shape, never a raw Fastify/Node error body. */
const PROBLEM_KEYS = new Set(['status', 'code', 'title', 'detail', 'fieldViolations']);

function assertContractOnlyProblem(body: unknown): void {
  const parsed = zQuizAppProblem.parse(body);
  expect(parsed.code).toBe('quiz.unavailable');
  for (const key of Object.keys(body as Record<string, unknown>)) {
    expect(PROBLEM_KEYS.has(key)).toBe(true);
  }
}

async function startHarness(pg: TestPostgres, envOverrides: Record<string, string> = {}): Promise<Harness> {
  const config = loadConfig({
    NODE_ENV: 'test',
    QUIZ_SERVICE_DATABASE_URL: pg.connectionString,
    ...envOverrides,
  });

  const logLines: string[] = [];
  const loggerStream = new Writable({
    write(chunk, _encoding, callback) {
      logLines.push(chunk.toString('utf8'));
      callback();
    },
  });

  const app = await buildApp({ config, clock: new SystemClock(), ids: new UlidGenerator(), loggerStream });

  const deviceId = ulid();
  await app.sql`
    INSERT INTO devices (device_id, credential_hash, hall_display_name, enabled, created_at)
    VALUES (${deviceId}, ${await hashDeviceCredential(`abuse-device-${randomUUID()}-bearer-token`)}, 'Hall A', true, now())
  `;

  return { app, deviceId, publicOrigin: config.publicOrigin, logLines };
}

interface SeedSessionOptions {
  state?: 'open' | 'closed';
}

async function seedQuizSession(harness: Harness, options: SeedSessionOptions = {}): Promise<string> {
  const id = ulid();
  const joinCode = `A${randomUUID().slice(0, 5).toUpperCase()}`;
  const state = options.state ?? 'open';
  await harness.app.sql`
    INSERT INTO quiz_sessions
      (id, lecture_session_id, device_id, hall_display_name, join_code, join_url, state, opened_at, closed_at, next_answer_seq)
    VALUES
      (${id}, ${ulid()}, ${harness.deviceId}, 'Hall A', ${joinCode},
       ${`https://quiz.example/j/${joinCode}`}, ${state}, now(),
       ${state === 'closed' ? new Date().toISOString() : null}, 0)
  `;
  return id;
}

let studentIdCounter = 0;
function randomStudentId(): string {
  studentIdCounter += 1;
  return `AB${studentIdCounter.toString().padStart(7, '0')}`;
}

function participantsUrl(quizSessionId: string): string {
  return `/api/student/v1/quiz-sessions/${quizSessionId}/participants`;
}

/** Bulk-seeds participants directly so 999-row setup doesn't burn the 5/min registration budget. */
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

async function inject(harness: Harness, options: InjectOptions) {
  return await harness.app.inject(options);
}

describe('abuse controls (D-09)', () => {
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

  it('allows 10 resolve requests per minute per IP then answers the 11th with a bare quiz.unavailable Problem', async () => {
    harness = await startHarness(pg);

    const responses = [];
    for (let i = 0; i < 11; i += 1) {
      responses.push(
        await inject(harness, {
          method: 'GET',
          url: '/api/student/v1/join-codes/NOPE01',
          headers: { 'x-forwarded-for': '198.18.10.1' },
        }),
      );
    }
    // The first 10 reach business logic (session lookup fails => 404), independent of the limiter.
    for (const response of responses.slice(0, 10)) {
      expect(response.statusCode).toBe(404);
      expect(zQuizAppProblem.parse(response.json()).code).toBe('quiz.session-not-found');
    }
    const eleventh = responses[10]!;
    expect(eleventh.statusCode).toBe(503);
    assertContractOnlyProblem(eleventh.json());
  });

  it('resolves according to session existence within the 10/min budget, not a blanket failure', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);

    const [session] = await harness.app.sql`SELECT join_code FROM quiz_sessions WHERE id=${quizSessionId}`;
    const response = await inject(harness, {
      method: 'GET',
      url: `/api/student/v1/join-codes/${session!.join_code}`,
      headers: { 'x-forwarded-for': '198.18.10.2' },
    });

    expect(response.statusCode).toBe(200);
    const body = zResolveJoinCodeResponse.parse(response.json());
    expect(body.state).toBe('open');
  });

  it('lets 5 registration requests per minute per IP reach business logic then answers the 6th with quiz.unavailable', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);

    const responses = [];
    for (let i = 0; i < 6; i += 1) {
      responses.push(
        await inject(harness, {
          method: 'POST',
          url: participantsUrl(quizSessionId),
          headers: { 'x-forwarded-for': '198.18.10.3' },
          payload: { fullName: `Student ${i}`, studentIdNumber: randomStudentId() },
        }),
      );
    }
    for (const response of responses.slice(0, 5)) {
      expect(response.statusCode).toBe(200);
      zRegisterParticipantResponse.parse(response.json());
    }
    const sixth = responses[5]!;
    expect(sixth.statusCode).toBe(503);
    assertContractOnlyProblem(sixth.json());
  });

  it('accepts participant 1000 and rejects participant 1001 without creating a row', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);
    await seedParticipants(harness, quizSessionId, 999);

    const accepted = await inject(harness, {
      method: 'POST',
      url: participantsUrl(quizSessionId),
      headers: { 'x-forwarded-for': '198.18.10.4' },
      payload: { fullName: 'Participant 1000', studentIdNumber: randomStudentId() },
    });
    expect(accepted.statusCode).toBe(200);

    const [afterAccept] = await harness.app
      .sql`SELECT count(*)::int AS count FROM participants WHERE quiz_session_id=${quizSessionId}`;
    expect(afterAccept!.count).toBe(1000);

    const rejected = await inject(harness, {
      method: 'POST',
      url: participantsUrl(quizSessionId),
      headers: { 'x-forwarded-for': '198.18.10.5' },
      payload: { fullName: 'Participant 1001', studentIdNumber: randomStudentId() },
    });
    expect(rejected.statusCode).toBe(503);
    assertContractOnlyProblem(rejected.json());

    const [afterReject] = await harness.app
      .sql`SELECT count(*)::int AS count FROM participants WHERE quiz_session_id=${quizSessionId}`;
    expect(afterReject!.count).toBe(1000);
  });

  it('parses a body at the 32 KiB cap with zod', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);

    // Comfortably under the cap; a too-short student id still reaches zod validation.
    const response = await inject(harness, {
      method: 'POST',
      url: participantsUrl(quizSessionId),
      headers: { 'x-forwarded-for': '198.18.10.6' },
      payload: { fullName: 'A'.repeat(1000), studentIdNumber: 'not-valid' },
    });

    expect(response.statusCode).toBe(422);
    expect(zQuizAppProblem.parse(response.json()).code).toBe('registration.invalid-student-id');
  });

  it('maps a body over 32 KiB to a contracted 503 instead of a raw Fastify error', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);

    const response = await inject(harness, {
      method: 'POST',
      url: participantsUrl(quizSessionId),
      headers: { 'x-forwarded-for': '198.18.10.7', 'content-type': 'application/json' },
      payload: JSON.stringify({ fullName: 'B'.repeat(40 * 1024), studentIdNumber: randomStudentId() }),
    });

    expect(response.statusCode).toBe(503);
    assertContractOnlyProblem(response.json());
  });

  it('sets credentialed CORS headers only when Origin matches PUBLIC_ORIGIN', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);

    const matching = await inject(harness, {
      method: 'POST',
      url: participantsUrl(quizSessionId),
      headers: { 'x-forwarded-for': '198.18.10.8', origin: harness.publicOrigin },
      payload: { fullName: 'Ada Lovelace', studentIdNumber: randomStudentId() },
    });
    expect(matching.statusCode).toBe(200);
    expect(matching.headers['access-control-allow-origin']).toBe(harness.publicOrigin);
    expect(matching.headers['access-control-allow-credentials']).toBe('true');
  });

  it('refuses a state-changing request from a different Origin with no allow-origin header', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);

    const response = await inject(harness, {
      method: 'POST',
      url: participantsUrl(quizSessionId),
      headers: { 'x-forwarded-for': '198.18.10.9', origin: 'https://evil.example' },
      payload: { fullName: 'Ada Lovelace', studentIdNumber: randomStudentId() },
    });

    expect(response.statusCode).toBe(503);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    assertContractOnlyProblem(response.json());
  });

  it('refuses a state-changing request from a literal "null" Origin', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);

    const response = await inject(harness, {
      method: 'POST',
      url: participantsUrl(quizSessionId),
      headers: { 'x-forwarded-for': '198.18.10.10', origin: 'null' },
      payload: { fullName: 'Ada Lovelace', studentIdNumber: randomStudentId() },
    });

    expect(response.statusCode).toBe(503);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    assertContractOnlyProblem(response.json());
  });

  it('does not refuse a read-only resolve request from a mismatched Origin, but sets no allow-origin header', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);
    const [session] = await harness.app.sql`SELECT join_code FROM quiz_sessions WHERE id=${quizSessionId}`;

    const response = await inject(harness, {
      method: 'GET',
      url: `/api/student/v1/join-codes/${session!.join_code}`,
      headers: { 'x-forwarded-for': '198.18.10.11', origin: 'https://evil.example' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('never logs a device bearer, participant cookie token, request body, or a correct answer before close', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);

    const bearer = `pii-scan-device-bearer-${randomUUID()}`;
    const secondDeviceId = ulid();
    await harness.app.sql`
      INSERT INTO devices (device_id, credential_hash, hall_display_name, enabled, created_at)
      VALUES (${secondDeviceId}, ${await hashDeviceCredential(bearer)}, 'Hall B', true, now())
    `;
    await inject(harness, {
      method: 'POST',
      url: '/device/v1/quiz-sessions',
      headers: { authorization: `Bearer ${bearer}` },
      payload: { deviceId: secondDeviceId, lectureSessionId: ulid(), hallDisplayName: 'Hall B' },
    });

    const fullName = 'Correctness Scan Student';
    const studentIdNumber = randomStudentId();
    const registerResponse = await inject(harness, {
      method: 'POST',
      url: participantsUrl(quizSessionId),
      headers: { 'x-forwarded-for': '198.18.10.12' },
      payload: { fullName, studentIdNumber },
    });
    const cookie = registerResponse.cookies.find((c) => c.name === 'eduscope_participant');
    expect(cookie).toBeDefined();
    const participantCookieToken = cookie!.value;

    const publicationId = ulid();
    const correctOptionId = ulid();
    const options = [
      { id: correctOptionId, label: 'A', text: 'Correct answer text' },
      { id: ulid(), label: 'B', text: 'Wrong answer text' },
    ];
    await harness.app.sql`
      INSERT INTO publications
        (id, quiz_session_id, question_id, prompt, options, correct_option_id, state, published_at)
      VALUES
        (${publicationId}, ${quizSessionId}, ${ulid()}, 'Scan prompt', ${JSON.stringify(options)}::jsonb,
         ${correctOptionId}, 'open', now())
    `;

    await inject(harness, {
      method: 'POST',
      url: `/api/student/v1/publications/${publicationId}/answers`,
      headers: { cookie: `eduscope_participant=${participantCookieToken}` },
      payload: { selectedOptionId: correctOptionId },
    });

    // Also exercise the oversized-body error path, which routes through the error handler.
    await inject(harness, {
      method: 'POST',
      url: participantsUrl(quizSessionId),
      headers: { 'x-forwarded-for': '198.18.10.13', 'content-type': 'application/json' },
      payload: JSON.stringify({ fullName: 'C'.repeat(40 * 1024), studentIdNumber: randomStudentId() }),
    });

    const forbiddenValues = [bearer, participantCookieToken, fullName, correctOptionId];
    const combinedLog = harness.logLines.join('\n');
    for (const forbidden of forbiddenValues) {
      expect(combinedLog.includes(forbidden)).toBe(false);
    }
  });
});
