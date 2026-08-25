import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ulid } from 'ulidx';
import type { FastifyInstance } from 'fastify';
import { parse as parseYaml } from 'yaml';
import { zProblem } from '@eduscope/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { hashDeviceCredential } from '../../src/device/credentials.js';
import { SystemClock } from '../../src/lib/clock.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { startTestPostgres, type TestPostgres } from '../helpers/postgres.js';

const DEVICE_TOKEN = 'contract-test-publication-device-b!';

const here = path.dirname(fileURLToPath(import.meta.url));
const OPENAPI_PATH = path.resolve(here, '../../../../contracts/openapi.yaml');

// openapi.yaml tag: quiz-sync — the two D-owned operations this task implements.
const EXPECTED_OPERATIONS = [
  { method: 'POST', url: '/device/v1/publications', operationId: 'quizSyncPublish' },
  { method: 'POST', url: '/device/v1/publications/:publicationId/close', operationId: 'quizSyncClosePublication' },
];

function pushPayload(quizSessionId: string): Record<string, unknown> {
  const optionA = ulid();
  const optionB = ulid();
  return {
    publicationId: ulid(),
    quizSessionId,
    questionId: ulid(),
    prompt: 'What is 2+2?',
    options: [
      { id: optionA, label: 'A', text: 'Four' },
      { id: optionB, label: 'B', text: 'Five' },
    ],
    correctOptionId: optionA,
    publishedAt: new Date().toISOString(),
  };
}

describe('device-publications contract (openapi.yaml tag: quiz-sync — quizSyncPublish, quizSyncClosePublication)', () => {
  let pg: TestPostgres;
  let app: FastifyInstance;
  let deviceId: string;
  let quizSessionId: string;
  let matchedOperationIds: string[];

  beforeAll(async () => {
    pg = await startTestPostgres();
    const config = loadConfig({ NODE_ENV: 'test', QUIZ_SERVICE_DATABASE_URL: pg.connectionString });
    app = await buildApp({ config, clock: new SystemClock(), ids: new UlidGenerator() });

    matchedOperationIds = [];
    app.addHook('onRequest', async (request) => {
      const routeConfig = request.routeOptions.config as { operationId?: string };
      if (routeConfig.operationId !== undefined) matchedOperationIds.push(routeConfig.operationId);
    });

    deviceId = ulid();
    await app.sql`
      INSERT INTO devices (device_id, credential_hash, hall_display_name, enabled, created_at)
      VALUES (${deviceId}, ${await hashDeviceCredential(DEVICE_TOKEN)}, 'Lecture Hall 1', true, now())
    `;
    quizSessionId = ulid();
    await app.sql`
      INSERT INTO quiz_sessions (id, lecture_session_id, device_id, hall_display_name, join_code, join_url, state, opened_at)
      VALUES (${quizSessionId}, ${ulid()}, ${deviceId}, 'Lecture Hall 1', ${ulid().slice(-6)}, 'http://example/j/AAA', 'open', now())
    `;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  it('routes POST /device/v1/publications to exactly operationId quizSyncPublish and returns an empty 201', async () => {
    matchedOperationIds.length = 0;
    const response = await app.inject({
      method: 'POST',
      url: '/device/v1/publications',
      headers: { authorization: `Bearer ${DEVICE_TOKEN}` },
      payload: pushPayload(quizSessionId),
    });
    expect(response.statusCode).toBe(201);
    expect(response.body).toBe('');
    expect(matchedOperationIds).toEqual(['quizSyncPublish']);
  });

  it('routes POST /device/v1/publications/:publicationId/close to exactly operationId quizSyncClosePublication', async () => {
    const payload = pushPayload(quizSessionId);
    await app.inject({
      method: 'POST',
      url: '/device/v1/publications',
      headers: { authorization: `Bearer ${DEVICE_TOKEN}` },
      payload,
    });

    matchedOperationIds.length = 0;
    const response = await app.inject({
      method: 'POST',
      url: `/device/v1/publications/${payload.publicationId}/close`,
      headers: { authorization: `Bearer ${DEVICE_TOKEN}` },
      payload: { publicationId: payload.publicationId, closedAt: new Date().toISOString(), closeReason: 'lecturer-closed' },
    });
    expect(response.statusCode).toBe(204);
    expect(matchedOperationIds).toEqual(['quizSyncClosePublication']);
  });

  it('parses the declared 409 Problem body against zProblem for quizSyncPublish', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/device/v1/publications',
      headers: { authorization: `Bearer ${DEVICE_TOKEN}` },
      payload: pushPayload(ulid()), // unknown quizSessionId
    });
    expect(response.statusCode).toBe(409);
    expect(() => zProblem.parse(response.json())).not.toThrow();
  });

  it('parses the 401 Problem body against zProblem for an unauthenticated request', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/device/v1/publications',
      payload: pushPayload(quizSessionId),
    });
    expect(response.statusCode).toBe(401);
    expect(() => zProblem.parse(response.json())).not.toThrow();
  });

  it('openapi.yaml declares each operationId at exactly this method/path pair', () => {
    const openapi = parseYaml(readFileSync(OPENAPI_PATH, 'utf8')) as {
      paths: Record<string, Record<string, { operationId?: string }>>;
    };
    for (const expected of EXPECTED_OPERATIONS) {
      const openapiPath = expected.url.replace(':publicationId', '{publicationId}');
      const operation = openapi.paths[openapiPath]?.[expected.method.toLowerCase()];
      expect(operation?.operationId).toBe(expected.operationId);
    }
  });
});
