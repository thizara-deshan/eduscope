import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ulid } from 'ulidx';
import type { FastifyInstance } from 'fastify';
import { parse as parseYaml } from 'yaml';
import { zProblem, zQuizSessionCreateResponse } from '@eduscope/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { hashDeviceCredential } from '../../src/device/credentials.js';
import { SystemClock } from '../../src/lib/clock.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { startTestPostgres, type TestPostgres } from '../helpers/postgres.js';

const DEVICE_TOKEN = 'contract-test-device-bearer-32-byt!';

const here = path.dirname(fileURLToPath(import.meta.url));
const OPENAPI_PATH = path.resolve(here, '../../../../contracts/openapi.yaml');

// openapi.yaml tag: quiz-sync — the two D-owned operations this task implements.
const EXPECTED_OPERATIONS = [
  { method: 'POST', url: '/device/v1/quiz-sessions', operationId: 'quizSyncCreateSession' },
  { method: 'POST', url: '/device/v1/quiz-sessions/:quizSessionId/close', operationId: 'quizSyncCloseSession' },
];

describe('device-sessions contract (openapi.yaml tag: quiz-sync — quizSyncCreateSession, quizSyncCloseSession)', () => {
  let pg: TestPostgres;
  let app: FastifyInstance;
  let deviceId: string;
  let matchedOperationIds: string[];

  beforeAll(async () => {
    pg = await startTestPostgres();
    const config = loadConfig({ NODE_ENV: 'test', QUIZ_SERVICE_DATABASE_URL: pg.connectionString });
    app = await buildApp({ config, clock: new SystemClock(), ids: new UlidGenerator() });

    matchedOperationIds = [];
    app.addHook('onRequest', async (request) => {
      const config = request.routeOptions.config as { operationId?: string };
      if (config.operationId !== undefined) matchedOperationIds.push(config.operationId);
    });

    deviceId = ulid();
    await app.sql`
      INSERT INTO devices (device_id, credential_hash, hall_display_name, enabled, created_at)
      VALUES (${deviceId}, ${await hashDeviceCredential(DEVICE_TOKEN)}, 'Lecture Hall 1', true, now())
    `;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  it('routes POST /device/v1/quiz-sessions to exactly operationId quizSyncCreateSession', async () => {
    matchedOperationIds.length = 0;
    const response = await app.inject({
      method: 'POST',
      url: '/device/v1/quiz-sessions',
      headers: { authorization: `Bearer ${DEVICE_TOKEN}` },
      payload: { lectureSessionId: ulid(), deviceId, hallDisplayName: 'Lecture Hall 1' },
    });
    expect(response.statusCode).toBe(201);
    expect(matchedOperationIds).toEqual(['quizSyncCreateSession']);
    expect(() => zQuizSessionCreateResponse.parse(response.json())).not.toThrow();
  });

  it('routes POST /device/v1/quiz-sessions/:quizSessionId/close to exactly operationId quizSyncCloseSession', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/device/v1/quiz-sessions',
      headers: { authorization: `Bearer ${DEVICE_TOKEN}` },
      payload: { lectureSessionId: ulid(), deviceId, hallDisplayName: 'Lecture Hall 1' },
    });
    const { id: quizSessionId } = created.json() as { id: string };

    matchedOperationIds.length = 0;
    const response = await app.inject({
      method: 'POST',
      url: `/device/v1/quiz-sessions/${quizSessionId}/close`,
      headers: { authorization: `Bearer ${DEVICE_TOKEN}` },
    });
    expect(response.statusCode).toBe(204);
    expect(matchedOperationIds).toEqual(['quizSyncCloseSession']);
  });

  it('parses the 409 Problem body against zProblem when a lecture collides across devices', async () => {
    const otherDeviceId = ulid();
    await app.sql`
      INSERT INTO devices (device_id, credential_hash, hall_display_name, enabled, created_at)
      VALUES (${otherDeviceId}, ${await hashDeviceCredential('second-contract-device-bearer-32!')}, 'Lecture Hall 2', true, now())
    `;
    const lectureSessionId = ulid();

    const first = await app.inject({
      method: 'POST',
      url: '/device/v1/quiz-sessions',
      headers: { authorization: `Bearer ${DEVICE_TOKEN}` },
      payload: { lectureSessionId, deviceId, hallDisplayName: 'Lecture Hall 1' },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: 'POST',
      url: '/device/v1/quiz-sessions',
      headers: { authorization: 'Bearer second-contract-device-bearer-32!' },
      payload: { lectureSessionId, deviceId: otherDeviceId, hallDisplayName: 'Lecture Hall 2' },
    });
    expect(second.statusCode).toBe(409);
    expect(() => zProblem.parse(second.json())).not.toThrow();
  });

  it('parses the 401 Problem body against zProblem for an unauthenticated request', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/device/v1/quiz-sessions',
      payload: { lectureSessionId: ulid(), deviceId, hallDisplayName: 'Lecture Hall 1' },
    });
    expect(response.statusCode).toBe(401);
    expect(() => zProblem.parse(response.json())).not.toThrow();
  });

  it('openapi.yaml declares each operationId at exactly this method/path pair', () => {
    const openapi = parseYaml(readFileSync(OPENAPI_PATH, 'utf8')) as {
      paths: Record<string, Record<string, { operationId?: string }>>;
    };
    for (const expected of EXPECTED_OPERATIONS) {
      const openapiPath = expected.url.replace(':quizSessionId', '{quizSessionId}');
      const operation = openapi.paths[openapiPath]?.[expected.method.toLowerCase()];
      expect(operation?.operationId).toBe(expected.operationId);
    }
  });
});
