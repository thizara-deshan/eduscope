import { randomUUID } from 'node:crypto';
import { ulid } from 'ulidx';
import type { FastifyInstance } from 'fastify';
import { zQuizAppProblem, zSubmitAnswerResponse } from '@eduscope/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { hashDeviceCredential } from '../../src/device/credentials.js';
import type { QuizDomainEventPayload } from '../../src/device/publication-routes.js';
import { EventEmitterDomainNotifier } from '../../src/device/publication-routes.js';
import { SystemClock } from '../../src/lib/clock.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { startTestPostgres, type TestPostgres } from '../helpers/postgres.js';

interface Harness {
  app: FastifyInstance;
  domainEvents: EventEmitterDomainNotifier;
  deviceId: string;
  deviceToken: string;
}

async function startHarness(pg: TestPostgres): Promise<Harness> {
  const config = loadConfig({ NODE_ENV: 'test', QUIZ_SERVICE_DATABASE_URL: pg.connectionString });
  const domainEvents = new EventEmitterDomainNotifier();
  const app = await buildApp({ config, clock: new SystemClock(), ids: new UlidGenerator(), domainEvents });

  const deviceId = ulid();
  const deviceToken = `device-${randomUUID()}-bearer-token`;
  await app.sql`
    INSERT INTO devices (device_id, credential_hash, hall_display_name, enabled, created_at)
    VALUES (${deviceId}, ${await hashDeviceCredential(deviceToken)}, 'Hall A', true, now())
  `;

  return { app, domainEvents, deviceId, deviceToken };
}

function deviceHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

async function seedQuizSession(harness: Harness, options: { state?: 'open' | 'closed' } = {}): Promise<string> {
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

interface PublishedOption {
  id: string;
  label: 'A' | 'B';
  text: string;
}

interface PublishedQuestion {
  publicationId: string;
  correctOptionId: string;
  wrongOptionId: string;
}

async function publish(
  harness: Harness,
  quizSessionId: string,
  overrides: { publishedAt?: string } = {},
): Promise<PublishedQuestion> {
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
      publishedAt: overrides.publishedAt ?? new Date().toISOString(),
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

let studentIdCounter = 0;
function randomStudentId(): string {
  studentIdCounter += 1;
  return `AN${studentIdCounter.toString().padStart(7, '0')}`;
}

async function registerParticipant(harness: Harness, quizSessionId: string): Promise<string> {
  const response = await harness.app.inject({
    method: 'POST',
    url: `/api/student/v1/quiz-sessions/${quizSessionId}/participants`,
    payload: { fullName: 'Ada Lovelace', studentIdNumber: randomStudentId() },
  });
  expect(response.statusCode).toBe(200);
  const cookie = response.cookies.find((c) => c.name === 'eduscope_participant');
  return `eduscope_participant=${cookie!.value}`;
}

function answerUrl(publicationId: string): string {
  return `/api/student/v1/publications/${publicationId}/answers`;
}

describe('student answer ingestion (submitAnswer)', () => {
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

  it('rejects an unauthenticated request with 409 question.closed', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);
    const { publicationId, correctOptionId } = await publish(harness, quizSessionId);

    const response = await harness.app.inject({
      method: 'POST',
      url: answerUrl(publicationId),
      payload: { selectedOptionId: correctOptionId },
    });

    expect(response.statusCode).toBe(409);
    expect(zQuizAppProblem.parse(response.json()).code).toBe('question.closed');
  });

  it('rejects a publication outside the cookie participant\'s own session with 409 question.closed', async () => {
    harness = await startHarness(pg);
    const ownSessionId = await seedQuizSession(harness);
    const otherSessionId = await seedQuizSession(harness);
    const cookie = await registerParticipant(harness, ownSessionId);
    const { publicationId, correctOptionId } = await publish(harness, otherSessionId);

    const response = await harness.app.inject({
      method: 'POST',
      url: answerUrl(publicationId),
      headers: { cookie },
      payload: { selectedOptionId: correctOptionId },
    });

    expect(response.statusCode).toBe(409);
    expect(zQuizAppProblem.parse(response.json()).code).toBe('question.closed');
  });

  it('accepts a valid option and returns the accepted outcome', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);
    const cookie = await registerParticipant(harness, quizSessionId);
    const { publicationId, correctOptionId } = await publish(harness, quizSessionId);

    const response = await harness.app.inject({
      method: 'POST',
      url: answerUrl(publicationId),
      headers: { cookie },
      payload: { selectedOptionId: correctOptionId },
    });

    expect(response.statusCode).toBe(200);
    const body = zSubmitAnswerResponse.parse(response.json());
    expect(body.outcome).toBe('accepted');
    expect(body.selectedOptionId).toBe(correctOptionId);
  });

  it('rejects a non-ULID selectedOptionId with 422 answer.invalid-option', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);
    const cookie = await registerParticipant(harness, quizSessionId);
    const { publicationId } = await publish(harness, quizSessionId);

    const response = await harness.app.inject({
      method: 'POST',
      url: answerUrl(publicationId),
      headers: { cookie },
      payload: { selectedOptionId: 'not-a-ulid' },
    });

    expect(response.statusCode).toBe(422);
    expect(zQuizAppProblem.parse(response.json()).code).toBe('answer.invalid-option');
  });

  it('rejects a well-formed but unpublished option id with 422 answer.invalid-option', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);
    const cookie = await registerParticipant(harness, quizSessionId);
    const { publicationId } = await publish(harness, quizSessionId);

    const response = await harness.app.inject({
      method: 'POST',
      url: answerUrl(publicationId),
      headers: { cookie },
      payload: { selectedOptionId: ulid() },
    });

    expect(response.statusCode).toBe(422);
    expect(zQuizAppProblem.parse(response.json()).code).toBe('answer.invalid-option');
  });

  it('rejects an answer to a closed publication with 409 question.closed', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);
    const cookie = await registerParticipant(harness, quizSessionId);
    const { publicationId, correctOptionId } = await publish(harness, quizSessionId);
    await closePublication(harness, publicationId);

    const response = await harness.app.inject({
      method: 'POST',
      url: answerUrl(publicationId),
      headers: { cookie },
      payload: { selectedOptionId: correctOptionId },
    });

    expect(response.statusCode).toBe(409);
    expect(zQuizAppProblem.parse(response.json()).code).toBe('question.closed');
  });

  it('rejects an answer once the quiz session itself is closed', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);
    const cookie = await registerParticipant(harness, quizSessionId);
    const { publicationId, correctOptionId } = await publish(harness, quizSessionId);

    const closeResponse = await harness.app.inject({
      method: 'POST',
      url: `/device/v1/quiz-sessions/${quizSessionId}/close`,
      headers: deviceHeaders(harness.deviceToken),
    });
    expect(closeResponse.statusCode).toBe(204);

    const response = await harness.app.inject({
      method: 'POST',
      url: answerUrl(publicationId),
      headers: { cookie },
      payload: { selectedOptionId: correctOptionId },
    });

    expect(response.statusCode).toBe(409);
    expect(zQuizAppProblem.parse(response.json()).code).toBe('question.closed');
  });

  it('is idempotent on a same-option retry and stores exactly one row', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);
    const cookie = await registerParticipant(harness, quizSessionId);
    const { publicationId, correctOptionId } = await publish(harness, quizSessionId);

    const first = await harness.app.inject({
      method: 'POST',
      url: answerUrl(publicationId),
      headers: { cookie },
      payload: { selectedOptionId: correctOptionId },
    });
    const second = await harness.app.inject({
      method: 'POST',
      url: answerUrl(publicationId),
      headers: { cookie },
      payload: { selectedOptionId: correctOptionId },
    });

    expect(zSubmitAnswerResponse.parse(first.json()).outcome).toBe('accepted');
    const secondBody = zSubmitAnswerResponse.parse(second.json());
    expect(secondBody.outcome).toBe('already-accepted');
    expect(secondBody.selectedOptionId).toBe(correctOptionId);

    const rows = await harness.app.sql`SELECT count(*)::int AS count FROM answers WHERE publication_id = ${publicationId}`;
    expect(rows[0]?.count).toBe(1);
  });

  it('returns the first stored option on a different-option retry, never overwriting it', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);
    const cookie = await registerParticipant(harness, quizSessionId);
    const { publicationId, correctOptionId, wrongOptionId } = await publish(harness, quizSessionId);

    await harness.app.inject({
      method: 'POST',
      url: answerUrl(publicationId),
      headers: { cookie },
      payload: { selectedOptionId: wrongOptionId },
    });
    const retry = await harness.app.inject({
      method: 'POST',
      url: answerUrl(publicationId),
      headers: { cookie },
      payload: { selectedOptionId: correctOptionId },
    });

    const body = zSubmitAnswerResponse.parse(retry.json());
    expect(body.outcome).toBe('already-accepted');
    expect(body.selectedOptionId).toBe(wrongOptionId);

    const [row] = await harness.app.sql`SELECT selected_option_id, is_correct FROM answers WHERE publication_id = ${publicationId}`;
    expect(row?.selected_option_id).toBe(wrongOptionId);
    expect(row?.is_correct).toBe(false);
  });

  it('stores correctness and 0/10 points at submit time', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);
    const correctCookie = await registerParticipant(harness, quizSessionId);
    const wrongCookie = await registerParticipant(harness, quizSessionId);
    const { publicationId, correctOptionId, wrongOptionId } = await publish(harness, quizSessionId);

    await harness.app.inject({
      method: 'POST',
      url: answerUrl(publicationId),
      headers: { cookie: correctCookie },
      payload: { selectedOptionId: correctOptionId },
    });
    await harness.app.inject({
      method: 'POST',
      url: answerUrl(publicationId),
      headers: { cookie: wrongCookie },
      payload: { selectedOptionId: wrongOptionId },
    });

    const rows = await harness.app
      .sql`SELECT is_correct, points_awarded FROM answers WHERE publication_id = ${publicationId} ORDER BY points_awarded DESC`;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ is_correct: true, points_awarded: 10 });
    expect(rows[1]).toMatchObject({ is_correct: false, points_awarded: 0 });
  });

  it('computes response time from server receive time relative to publishedAt', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);
    const cookie = await registerParticipant(harness, quizSessionId);
    const publishedAt = new Date(Date.now() - 5_000).toISOString();
    const { publicationId, correctOptionId } = await publish(harness, quizSessionId, { publishedAt });

    await harness.app.inject({
      method: 'POST',
      url: answerUrl(publicationId),
      headers: { cookie },
      payload: { selectedOptionId: correctOptionId },
    });

    const [row] = await harness.app.sql`SELECT response_time_ms FROM answers WHERE publication_id = ${publicationId}`;
    expect(row?.response_time_ms).toBeGreaterThanOrEqual(4_500);
  });

  it('clamps a negative clock skew (publishedAt after receive time) to zero', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);
    const cookie = await registerParticipant(harness, quizSessionId);
    const publishedAt = new Date(Date.now() + 60_000).toISOString();
    const { publicationId, correctOptionId } = await publish(harness, quizSessionId, { publishedAt });

    await harness.app.inject({
      method: 'POST',
      url: answerUrl(publicationId),
      headers: { cookie },
      payload: { selectedOptionId: correctOptionId },
    });

    const [row] = await harness.app.sql`SELECT response_time_ms FROM answers WHERE publication_id = ${publicationId}`;
    expect(row?.response_time_ms).toBe(0);
  });

  it('converges 20 concurrent submissions from the same participant onto exactly one row', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);
    const cookie = await registerParticipant(harness, quizSessionId);
    const { publicationId, correctOptionId } = await publish(harness, quizSessionId);

    const responses = await Promise.all(
      Array.from({ length: 20 }, () =>
        harness!.app.inject({
          method: 'POST',
          url: answerUrl(publicationId),
          headers: { cookie },
          payload: { selectedOptionId: correctOptionId },
        }),
      ),
    );

    for (const response of responses) {
      expect(response.statusCode).toBe(200);
      expect(zSubmitAnswerResponse.parse(response.json()).selectedOptionId).toBe(correctOptionId);
    }
    const accepted = responses.filter((r) => zSubmitAnswerResponse.parse(r.json()).outcome === 'accepted');
    expect(accepted).toHaveLength(1);

    const rows = await harness.app.sql`SELECT count(*)::int AS count FROM answers WHERE publication_id = ${publicationId}`;
    expect(rows[0]?.count).toBe(1);
  }, 30_000);

  it('keeps per-session seq strictly increasing and never reused across publications, allowing gaps from losing duplicates', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);
    const first = await publish(harness, quizSessionId);
    const firstCookie = await registerParticipant(harness, quizSessionId);
    const secondCookie = await registerParticipant(harness, quizSessionId);

    await Promise.all(
      [firstCookie, secondCookie].map((cookie) =>
        harness!.app.inject({
          method: 'POST',
          url: answerUrl(first.publicationId),
          headers: { cookie },
          payload: { selectedOptionId: first.correctOptionId },
        }),
      ),
    );
    await closePublication(harness, first.publicationId);
    const second = await publish(harness, quizSessionId);
    await harness.app.inject({
      method: 'POST',
      url: answerUrl(second.publicationId),
      headers: { cookie: firstCookie },
      payload: { selectedOptionId: second.correctOptionId },
    });

    const rows = await harness.app.sql`SELECT seq FROM answers WHERE quiz_session_id = ${quizSessionId} ORDER BY seq`;
    const seqs = rows.map((r) => Number(r.seq));
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });

  it('serializes a racing answer and close deterministically under the shared session key', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);
    const cookie = await registerParticipant(harness, quizSessionId);
    const { publicationId, correctOptionId } = await publish(harness, quizSessionId);

    const [answerResponse, closeResponse] = await Promise.all([
      harness.app.inject({
        method: 'POST',
        url: answerUrl(publicationId),
        headers: { cookie },
        payload: { selectedOptionId: correctOptionId },
      }),
      harness.app.inject({
        method: 'POST',
        url: `/device/v1/publications/${publicationId}/close`,
        headers: deviceHeaders(harness.deviceToken),
        payload: { publicationId, closedAt: new Date().toISOString(), closeReason: 'lecturer-closed' },
      }),
    ]);

    expect(closeResponse.statusCode).toBe(204);
    expect([200, 409]).toContain(answerResponse.statusCode);
    if (answerResponse.statusCode === 200) {
      expect(zSubmitAnswerResponse.parse(answerResponse.json()).outcome).toBe('accepted');
    } else {
      expect(zQuizAppProblem.parse(answerResponse.json()).code).toBe('question.closed');
    }
  });

  it('emits an ids/seq-only answer.accepted notification without exposing it on the REST response', async () => {
    harness = await startHarness(pg);
    const quizSessionId = await seedQuizSession(harness);
    const cookie = await registerParticipant(harness, quizSessionId);
    const { publicationId, correctOptionId } = await publish(harness, quizSessionId);

    const events: QuizDomainEventPayload[] = [];
    harness.domainEvents.on('answer.accepted', (payload) => events.push(payload));

    const response = await harness.app.inject({
      method: 'POST',
      url: answerUrl(publicationId),
      headers: { cookie },
      payload: { selectedOptionId: correctOptionId },
    });

    expect(response.body).not.toContain('seq');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ quizSessionId, seq: 1 });
    expect(events[0]?.answerId).toBeDefined();
    expect(JSON.stringify(events[0])).not.toContain('selectedOptionId');
    expect(JSON.stringify(events[0])).not.toContain('isCorrect');
  });
});
