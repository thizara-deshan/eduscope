import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ulid } from 'ulidx';
import type { FastifyInstance } from 'fastify';
import { parse as parseYaml } from 'yaml';
import { zQuizAppProblem, zRegisterParticipantResponse, zResolveJoinCodeResponse } from '@eduscope/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { hashDeviceCredential } from '../../src/device/credentials.js';
import { SystemClock } from '../../src/lib/clock.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { startTestPostgres, type TestPostgres } from '../helpers/postgres.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const QUIZ_APP_PATH = path.resolve(here, '../../../../contracts/quiz-app.yaml');

// quiz-app.yaml tag: student-quiz — the two D-owned operations this task implements.
const EXPECTED_OPERATIONS = [
  {
    method: 'GET',
    url: '/api/student/v1/join-codes/:joinCode',
    contractPath: '/join-codes/{joinCode}',
    operationId: 'resolveJoinCode',
  },
  {
    method: 'POST',
    url: '/api/student/v1/quiz-sessions/:quizSessionId/participants',
    contractPath: '/quiz-sessions/{quizSessionId}/participants',
    operationId: 'registerParticipant',
  },
];

describe('student-registration contract (quiz-app.yaml tag: student-quiz — resolveJoinCode, registerParticipant)', () => {
  let pg: TestPostgres;
  let app: FastifyInstance;
  let deviceId: string;
  let quizSessionId: string;
  let joinCode: string;
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
      VALUES (${deviceId}, ${await hashDeviceCredential(`contract-device-${randomUUID()}-bearer-token`)}, 'Contract Hall', true, now())
    `;

    quizSessionId = ulid();
    joinCode = `C${randomUUID().slice(0, 5).toUpperCase()}`;
    await app.sql`
      INSERT INTO quiz_sessions (id, lecture_session_id, device_id, hall_display_name, join_code, join_url, state, opened_at, next_answer_seq)
      VALUES (${quizSessionId}, ${ulid()}, ${deviceId}, 'Contract Hall', ${joinCode}, ${`https://quiz.example/j/${joinCode}`}, 'open', now(), 0)
    `;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  it('routes GET .../join-codes/:joinCode to exactly operationId resolveJoinCode', async () => {
    matchedOperationIds.length = 0;
    const response = await app.inject({ method: 'GET', url: `/api/student/v1/join-codes/${joinCode}` });
    expect(response.statusCode).toBe(200);
    expect(matchedOperationIds).toEqual(['resolveJoinCode']);
    expect(() => zResolveJoinCodeResponse.parse(response.json())).not.toThrow();
  });

  it('parses the 404 Problem body against zQuizAppProblem for an unknown join code', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/student/v1/join-codes/ZZZZZZ' });
    expect(response.statusCode).toBe(404);
    expect(() => zQuizAppProblem.parse(response.json())).not.toThrow();
  });

  it('routes POST .../participants to exactly operationId registerParticipant', async () => {
    matchedOperationIds.length = 0;
    const response = await app.inject({
      method: 'POST',
      url: `/api/student/v1/quiz-sessions/${quizSessionId}/participants`,
      payload: { fullName: 'Contract Student', studentIdNumber: 'CS1234567' },
    });
    expect(response.statusCode).toBe(200);
    expect(matchedOperationIds).toEqual(['registerParticipant']);
    expect(() => zRegisterParticipantResponse.parse(response.json())).not.toThrow();
  });

  it('parses the 422 Problem body against zQuizAppProblem for an invalid student id', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/student/v1/quiz-sessions/${quizSessionId}/participants`,
      payload: { fullName: 'Contract Student', studentIdNumber: 'invalid' },
    });
    expect(response.statusCode).toBe(422);
    expect(() => zQuizAppProblem.parse(response.json())).not.toThrow();
  });

  it('parses the 409 Problem body against zQuizAppProblem for a closed session', async () => {
    const closedSessionId = ulid();
    const closedJoinCode = `D${randomUUID().slice(0, 5).toUpperCase()}`;
    await app.sql`
      INSERT INTO quiz_sessions (id, lecture_session_id, device_id, hall_display_name, join_code, join_url, state, opened_at, closed_at, next_answer_seq)
      VALUES (${closedSessionId}, ${ulid()}, ${deviceId}, 'Contract Hall', ${closedJoinCode}, ${`https://quiz.example/j/${closedJoinCode}`}, 'closed', now(), now(), 0)
    `;

    const response = await app.inject({
      method: 'POST',
      url: `/api/student/v1/quiz-sessions/${closedSessionId}/participants`,
      payload: { fullName: 'Contract Student', studentIdNumber: 'CS7654321' },
    });
    expect(response.statusCode).toBe(409);
    expect(() => zQuizAppProblem.parse(response.json())).not.toThrow();
  });

  it('quiz-app.yaml declares each operationId at exactly this method/path pair', () => {
    const quizApp = parseYaml(readFileSync(QUIZ_APP_PATH, 'utf8')) as {
      paths: Record<string, Record<string, { operationId?: string }>>;
    };
    for (const expected of EXPECTED_OPERATIONS) {
      const operation = quizApp.paths[expected.contractPath]?.[expected.method.toLowerCase()];
      expect(operation?.operationId).toBe(expected.operationId);
    }
  });
});
