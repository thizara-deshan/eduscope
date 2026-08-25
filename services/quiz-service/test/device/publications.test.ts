import { randomUUID } from 'node:crypto';
import { ulid } from 'ulidx';
import type { FastifyInstance } from 'fastify';
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
  otherDeviceId: string;
  otherDeviceToken: string;
  quizSessionId: string;
  otherQuizSessionId: string;
}

interface PublishOption {
  id: string;
  label: string;
  text: string;
}

interface PublishPayload {
  publicationId: string;
  quizSessionId: string;
  questionId: string;
  prompt: string;
  options: PublishOption[];
  correctOptionId: string;
  publishedAt: string;
}

function options(): PublishOption[] {
  return [
    { id: ulid(), label: 'A', text: 'Option A' },
    { id: ulid(), label: 'B', text: 'Option B' },
  ];
}

async function startHarness(pg: TestPostgres): Promise<Harness> {
  const config = loadConfig({ NODE_ENV: 'test', QUIZ_SERVICE_DATABASE_URL: pg.connectionString });
  const domainEvents = new EventEmitterDomainNotifier();
  const app = await buildApp({ config, clock: new SystemClock(), ids: new UlidGenerator(), domainEvents });

  const deviceId = ulid();
  const otherDeviceId = ulid();
  const deviceToken = `device-${randomUUID()}-bearer-token`;
  const otherDeviceToken = `device-${randomUUID()}-bearer-token`;
  await app.sql`
    INSERT INTO devices (device_id, credential_hash, hall_display_name, enabled, created_at)
    VALUES (${deviceId}, ${await hashDeviceCredential(deviceToken)}, 'Hall A', true, now())
  `;
  await app.sql`
    INSERT INTO devices (device_id, credential_hash, hall_display_name, enabled, created_at)
    VALUES (${otherDeviceId}, ${await hashDeviceCredential(otherDeviceToken)}, 'Hall B', true, now())
  `;

  const quizSessionId = ulid();
  await app.sql`
    INSERT INTO quiz_sessions (id, lecture_session_id, device_id, hall_display_name, join_code, join_url, state, opened_at)
    VALUES (${quizSessionId}, ${ulid()}, ${deviceId}, 'Hall A', ${ulid().slice(-6)}, 'http://example/j/AAA', 'open', now())
  `;
  const otherQuizSessionId = ulid();
  await app.sql`
    INSERT INTO quiz_sessions (id, lecture_session_id, device_id, hall_display_name, join_code, join_url, state, opened_at)
    VALUES (${otherQuizSessionId}, ${ulid()}, ${otherDeviceId}, 'Hall B', ${ulid().slice(-6)}, 'http://example/j/BBB', 'open', now())
  `;

  return { app, domainEvents, deviceId, deviceToken, otherDeviceId, otherDeviceToken, quizSessionId, otherQuizSessionId };
}

function headers(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function pushPayload(quizSessionId: string, overrides: Partial<PublishPayload> = {}): PublishPayload {
  const opts = options();
  return {
    publicationId: ulid(),
    quizSessionId,
    questionId: ulid(),
    prompt: 'What is 2+2?',
    options: opts,
    correctOptionId: opts[0]!.id,
    publishedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('device publication sync REST', () => {
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

  it('publishes a valid publication and returns an empty 201', async () => {
    harness = await startHarness(pg);
    const payload = pushPayload(harness.quizSessionId);
    const response = await harness.app.inject({
      method: 'POST',
      url: '/device/v1/publications',
      headers: headers(harness.deviceToken),
      payload,
    });
    expect(response.statusCode).toBe(201);
    expect(response.body).toBe('');

    const [row] = await harness.app.sql`SELECT state, correct_option_id FROM publications WHERE id = ${payload.publicationId}`;
    expect(row?.state).toBe('open');
    expect(row?.correct_option_id).toBe(payload.correctOptionId);
  });

  it('rejects a correctOptionId that is not one of the options', async () => {
    harness = await startHarness(pg);
    const payload = pushPayload(harness.quizSessionId, { correctOptionId: ulid() });
    const response = await harness.app.inject({
      method: 'POST',
      url: '/device/v1/publications',
      headers: headers(harness.deviceToken),
      payload,
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ status: 422, code: 'validation.invalid' });
  });

  it('rejects too few options with 422 validation.invalid', async () => {
    harness = await startHarness(pg);
    const singleOption = [{ id: ulid(), label: 'A', text: 'Only option' }];
    const payload = pushPayload(harness.quizSessionId, { options: singleOption, correctOptionId: singleOption[0]!.id });
    const response = await harness.app.inject({
      method: 'POST',
      url: '/device/v1/publications',
      headers: headers(harness.deviceToken),
      payload,
    });
    expect(response.statusCode).toBe(422);
  });

  it('rejects an invalid option label with 422 validation.invalid', async () => {
    harness = await startHarness(pg);
    const badOptions = [
      { id: ulid(), label: 'Z', text: 'Bad label' },
      { id: ulid(), label: 'B', text: 'Option B' },
    ];
    const payload = pushPayload(harness.quizSessionId, { options: badOptions, correctOptionId: badOptions[0]!.id });
    const response = await harness.app.inject({
      method: 'POST',
      url: '/device/v1/publications',
      headers: headers(harness.deviceToken),
      payload,
    });
    expect(response.statusCode).toBe(422);
  });

  it('rejects a non-ULID option id with 422 validation.invalid', async () => {
    harness = await startHarness(pg);
    const badOptions = [
      { id: 'not-a-ulid', label: 'A', text: 'Bad id' },
      { id: ulid(), label: 'B', text: 'Option B' },
    ];
    const payload = pushPayload(harness.quizSessionId, { options: badOptions, correctOptionId: badOptions[1]!.id });
    const response = await harness.app.inject({
      method: 'POST',
      url: '/device/v1/publications',
      headers: headers(harness.deviceToken),
      payload,
    });
    expect(response.statusCode).toBe(422);
  });

  it('returns 409 conflict when the quiz session is closed', async () => {
    harness = await startHarness(pg);
    await harness.app.sql`UPDATE quiz_sessions SET state = 'closed', closed_at = now() WHERE id = ${harness.quizSessionId}`;
    const payload = pushPayload(harness.quizSessionId);
    const response = await harness.app.inject({
      method: 'POST',
      url: '/device/v1/publications',
      headers: headers(harness.deviceToken),
      payload,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ status: 409, code: 'conflict' });
  });

  it('returns 409 conflict when the device does not own the quiz session', async () => {
    harness = await startHarness(pg);
    const payload = pushPayload(harness.otherQuizSessionId);
    const response = await harness.app.inject({
      method: 'POST',
      url: '/device/v1/publications',
      headers: headers(harness.deviceToken),
      payload,
    });
    expect(response.statusCode).toBe(409);
  });

  it('is idempotent on an identical replay of the same publicationId', async () => {
    harness = await startHarness(pg);
    const payload = pushPayload(harness.quizSessionId);

    const first = await harness.app.inject({ method: 'POST', url: '/device/v1/publications', headers: headers(harness.deviceToken), payload });
    expect(first.statusCode).toBe(201);
    const second = await harness.app.inject({ method: 'POST', url: '/device/v1/publications', headers: headers(harness.deviceToken), payload });
    expect(second.statusCode).toBe(201);

    const rows = await harness.app.sql`SELECT id, state FROM publications WHERE quiz_session_id = ${harness.quizSessionId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe('open');
  });

  it('upserts changed replicated fields on a changed replay without reopening', async () => {
    harness = await startHarness(pg);
    const payload = pushPayload(harness.quizSessionId);

    await harness.app.inject({ method: 'POST', url: '/device/v1/publications', headers: headers(harness.deviceToken), payload });
    const changed = { ...payload, prompt: 'Updated prompt?' };
    const response = await harness.app.inject({ method: 'POST', url: '/device/v1/publications', headers: headers(harness.deviceToken), payload: changed });
    expect(response.statusCode).toBe(201);

    const [row] = await harness.app.sql`SELECT prompt FROM publications WHERE id = ${payload.publicationId}`;
    expect(row?.prompt).toBe('Updated prompt?');
  });

  it('closes the previous open publication when the next one is published', async () => {
    harness = await startHarness(pg);
    const first = pushPayload(harness.quizSessionId);
    const second = pushPayload(harness.quizSessionId);

    await harness.app.inject({ method: 'POST', url: '/device/v1/publications', headers: headers(harness.deviceToken), payload: first });
    const response = await harness.app.inject({ method: 'POST', url: '/device/v1/publications', headers: headers(harness.deviceToken), payload: second });
    expect(response.statusCode).toBe(201);

    const [firstRow] = await harness.app.sql`SELECT state, close_reason FROM publications WHERE id = ${first.publicationId}`;
    expect(firstRow?.state).toBe('closed');
    expect(firstRow?.close_reason).toBe('next-question');

    const openRows = await harness.app.sql`SELECT id FROM publications WHERE quiz_session_id = ${harness.quizSessionId} AND state = 'open'`;
    expect(openRows).toHaveLength(1);
    expect(openRows[0]?.id).toBe(second.publicationId);
  });

  it('never exposes correctOptionId or isCorrect in the empty publish response', async () => {
    harness = await startHarness(pg);
    const payload = pushPayload(harness.quizSessionId);
    const response = await harness.app.inject({ method: 'POST', url: '/device/v1/publications', headers: headers(harness.deviceToken), payload });
    expect(response.body).not.toContain('correctOptionId');
    expect(response.body).not.toContain('isCorrect');
  });

  it('emits ids-only publication.opened, then publication.closed on the next publish', async () => {
    harness = await startHarness(pg);
    const events: Array<{ name: string; payload: QuizDomainEventPayload }> = [];
    harness.domainEvents.on('publication.opened', (payload) => events.push({ name: 'publication.opened', payload }));
    harness.domainEvents.on('publication.closed', (payload) => events.push({ name: 'publication.closed', payload }));

    const first = pushPayload(harness.quizSessionId);
    await harness.app.inject({ method: 'POST', url: '/device/v1/publications', headers: headers(harness.deviceToken), payload: first });
    expect(events).toEqual([{ name: 'publication.opened', payload: { quizSessionId: harness.quizSessionId, publicationId: first.publicationId } }]);

    events.length = 0;
    const second = pushPayload(harness.quizSessionId);
    await harness.app.inject({ method: 'POST', url: '/device/v1/publications', headers: headers(harness.deviceToken), payload: second });
    expect(events).toEqual([
      { name: 'publication.closed', payload: { quizSessionId: harness.quizSessionId, publicationId: first.publicationId } },
      { name: 'publication.opened', payload: { quizSessionId: harness.quizSessionId, publicationId: second.publicationId } },
    ]);
    for (const event of events) {
      expect(JSON.stringify(event.payload)).not.toContain('correctOptionId');
      expect(JSON.stringify(event.payload)).not.toContain('prompt');
    }
  });

  it('closes an open publication explicitly', async () => {
    harness = await startHarness(pg);
    const payload = pushPayload(harness.quizSessionId);
    await harness.app.inject({ method: 'POST', url: '/device/v1/publications', headers: headers(harness.deviceToken), payload });

    const closedAt = new Date().toISOString();
    const response = await harness.app.inject({
      method: 'POST',
      url: `/device/v1/publications/${payload.publicationId}/close`,
      headers: headers(harness.deviceToken),
      payload: { publicationId: payload.publicationId, closedAt, closeReason: 'lecturer-closed' },
    });
    expect(response.statusCode).toBe(204);

    const [row] = await harness.app.sql`SELECT state, close_reason FROM publications WHERE id = ${payload.publicationId}`;
    expect(row?.state).toBe('closed');
    expect(row?.close_reason).toBe('lecturer-closed');
  });

  it('rejects a path/body publicationId mismatch with 422 validation.invalid', async () => {
    harness = await startHarness(pg);
    const payload = pushPayload(harness.quizSessionId);
    await harness.app.inject({ method: 'POST', url: '/device/v1/publications', headers: headers(harness.deviceToken), payload });

    const response = await harness.app.inject({
      method: 'POST',
      url: `/device/v1/publications/${payload.publicationId}/close`,
      headers: headers(harness.deviceToken),
      payload: { publicationId: ulid(), closedAt: new Date().toISOString(), closeReason: 'lecturer-closed' },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ status: 422, code: 'validation.invalid' });
  });

  it('repeated close is idempotent and preserves the first authoritative close values', async () => {
    harness = await startHarness(pg);
    const payload = pushPayload(harness.quizSessionId);
    await harness.app.inject({ method: 'POST', url: '/device/v1/publications', headers: headers(harness.deviceToken), payload });

    const firstClose = await harness.app.inject({
      method: 'POST',
      url: `/device/v1/publications/${payload.publicationId}/close`,
      headers: headers(harness.deviceToken),
      payload: { publicationId: payload.publicationId, closedAt: new Date().toISOString(), closeReason: 'lecturer-closed' },
    });
    expect(firstClose.statusCode).toBe(204);
    const [afterFirst] = await harness.app.sql`SELECT closed_at, close_reason FROM publications WHERE id = ${payload.publicationId}`;

    const secondClose = await harness.app.inject({
      method: 'POST',
      url: `/device/v1/publications/${payload.publicationId}/close`,
      headers: headers(harness.deviceToken),
      payload: { publicationId: payload.publicationId, closedAt: new Date().toISOString(), closeReason: 'next-question' },
    });
    expect(secondClose.statusCode).toBe(204);
    const [afterSecond] = await harness.app.sql`SELECT closed_at, close_reason FROM publications WHERE id = ${payload.publicationId}`;

    expect(afterSecond?.closed_at).toEqual(afterFirst?.closed_at);
    expect(afterSecond?.close_reason).toBe(afterFirst?.close_reason);
  });

  it('serializes close against the next publish under the same session key', async () => {
    harness = await startHarness(pg);
    const first = pushPayload(harness.quizSessionId);
    await harness.app.inject({ method: 'POST', url: '/device/v1/publications', headers: headers(harness.deviceToken), payload: first });

    const second = pushPayload(harness.quizSessionId);
    const [closeResponse, publishResponse] = await Promise.all([
      harness.app.inject({
        method: 'POST',
        url: `/device/v1/publications/${first.publicationId}/close`,
        headers: headers(harness.deviceToken),
        payload: { publicationId: first.publicationId, closedAt: new Date().toISOString(), closeReason: 'lecturer-closed' },
      }),
      harness.app.inject({ method: 'POST', url: '/device/v1/publications', headers: headers(harness.deviceToken), payload: second }),
    ]);
    expect(closeResponse.statusCode).toBe(204);
    expect(publishResponse.statusCode).toBe(201);

    const openRows = await harness.app.sql`SELECT id FROM publications WHERE quiz_session_id = ${harness.quizSessionId} AND state = 'open'`;
    expect(openRows).toHaveLength(1);
    expect(openRows[0]?.id).toBe(second.publicationId);

    const [firstRow] = await harness.app.sql`SELECT state, close_reason FROM publications WHERE id = ${first.publicationId}`;
    expect(firstRow?.state).toBe('closed');
  });
});
