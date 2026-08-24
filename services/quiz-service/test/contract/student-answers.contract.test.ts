import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ulid } from 'ulidx';
import type { FastifyInstance } from 'fastify';
import { parse as parseYaml } from 'yaml';
import { zQuizAppProblem, zSubmitAnswerResponse } from '@eduscope/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { hashDeviceCredential } from '../../src/device/credentials.js';
import { SystemClock } from '../../src/lib/clock.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { startTestPostgres, type TestPostgres } from '../helpers/postgres.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const QUIZ_APP_PATH = path.resolve(here, '../../../../contracts/quiz-app.yaml');

function deviceHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

describe('student-answers contract (quiz-app.yaml tag: student-quiz — submitAnswer)', () => {
  let pg: TestPostgres;
  let app: FastifyInstance;
  let deviceId: string;
  let deviceToken: string;
  let quizSessionId: string;
  let publicationId: string;
  let correctOptionId: string;
  let cookie: string;
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
    deviceToken = `contract-device-${randomUUID()}-bearer-token`;
    await app.sql`
      INSERT INTO devices (device_id, credential_hash, hall_display_name, enabled, created_at)
      VALUES (${deviceId}, ${await hashDeviceCredential(deviceToken)}, 'Contract Hall', true, now())
    `;

    quizSessionId = ulid();
    const joinCode = `E${randomUUID().slice(0, 5).toUpperCase()}`;
    await app.sql`
      INSERT INTO quiz_sessions (id, lecture_session_id, device_id, hall_display_name, join_code, join_url, state, opened_at, next_answer_seq)
      VALUES (${quizSessionId}, ${ulid()}, ${deviceId}, 'Contract Hall', ${joinCode}, ${`https://quiz.example/j/${joinCode}`}, 'open', now(), 0)
    `;

    const registerResponse = await app.inject({
      method: 'POST',
      url: `/api/student/v1/quiz-sessions/${quizSessionId}/participants`,
      payload: { fullName: 'Contract Student', studentIdNumber: 'CS1234567' },
    });
    const registerCookie = registerResponse.cookies.find((c) => c.name === 'eduscope_participant');
    cookie = `eduscope_participant=${registerCookie!.value}`;

    publicationId = ulid();
    correctOptionId = ulid();
    const wrongOptionId = ulid();
    const publishResponse = await app.inject({
      method: 'POST',
      url: '/device/v1/publications',
      headers: deviceHeaders(deviceToken),
      payload: {
        publicationId,
        quizSessionId,
        questionId: ulid(),
        prompt: 'What is 2+2?',
        options: [
          { id: correctOptionId, label: 'A', text: 'Correct' },
          { id: wrongOptionId, label: 'B', text: 'Wrong' },
        ],
        correctOptionId,
        publishedAt: new Date().toISOString(),
      },
    });
    expect(publishResponse.statusCode).toBe(201);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  it('routes POST .../answers to exactly operationId submitAnswer', async () => {
    matchedOperationIds.length = 0;
    const response = await app.inject({
      method: 'POST',
      url: `/api/student/v1/publications/${publicationId}/answers`,
      headers: { cookie },
      payload: { selectedOptionId: correctOptionId },
    });
    expect(response.statusCode).toBe(200);
    expect(matchedOperationIds).toEqual(['submitAnswer']);
    expect(() => zSubmitAnswerResponse.parse(response.json())).not.toThrow();
  });

  it('parses the 409 Problem body against zQuizAppProblem for an unauthenticated request', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/student/v1/publications/${publicationId}/answers`,
      payload: { selectedOptionId: correctOptionId },
    });
    expect(response.statusCode).toBe(409);
    expect(() => zQuizAppProblem.parse(response.json())).not.toThrow();
  });

  it('parses the 422 Problem body against zQuizAppProblem for an invalid option', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/student/v1/publications/${publicationId}/answers`,
      headers: { cookie },
      payload: { selectedOptionId: 'not-a-ulid' },
    });
    expect(response.statusCode).toBe(422);
    expect(() => zQuizAppProblem.parse(response.json())).not.toThrow();
  });

  it('quiz-app.yaml declares submitAnswer at exactly this method/path pair', () => {
    const quizApp = parseYaml(readFileSync(QUIZ_APP_PATH, 'utf8')) as {
      paths: Record<string, Record<string, { operationId?: string }>>;
    };
    const operation = quizApp.paths['/publications/{publicationId}/answers']?.post;
    expect(operation?.operationId).toBe('submitAnswer');
  });
});
