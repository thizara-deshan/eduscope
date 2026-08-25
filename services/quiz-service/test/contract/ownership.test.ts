import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ulid } from 'ulidx';
import type { FastifyInstance } from 'fastify';
import { parse as parseYaml } from 'yaml';
import {
  PANEL_OPERATION_IDS,
  SERVER_SIDE_ONLY_OPERATION_IDS,
  zProblem,
  zQuizAppProblem,
  zQuizSessionCreateResponse,
  zQuizSyncClientMessage,
  zQuizSyncServerMessage,
  zRegisterParticipantResponse,
  zResolveJoinCodeResponse,
  zStudentServerEvent,
  zSubmitAnswerResponse,
} from '@eduscope/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { hashDeviceCredential } from '../../src/device/credentials.js';
import { SystemClock } from '../../src/lib/clock.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { startTestPostgres, type TestPostgres } from '../helpers/postgres.js';

const DEVICE_TOKEN = 'ownership-gate-device-bearer-32-byt';

const here = path.dirname(fileURLToPath(import.meta.url));
const OPENAPI_PATH = path.resolve(here, '../../../../contracts/openapi.yaml');
const QUIZ_APP_PATH = path.resolve(here, '../../../../contracts/quiz-app.yaml');

interface ExpectedOperation {
  operationId: string;
  method: string;
  openapiPath: string;
  fastifyUrl: string;
}

// The exact seven D-owned REST operations (master plan: four quiz-sync server
// operations, three student operations). Any omission or addition fails this
// suite, not a later task.
const EXPECTED_OPERATIONS: ExpectedOperation[] = [
  { operationId: 'quizSyncCreateSession', method: 'POST', openapiPath: '/device/v1/quiz-sessions', fastifyUrl: '/device/v1/quiz-sessions' },
  { operationId: 'quizSyncCloseSession', method: 'POST', openapiPath: '/device/v1/quiz-sessions/{quizSessionId}/close', fastifyUrl: '/device/v1/quiz-sessions/:quizSessionId/close' },
  { operationId: 'quizSyncPublish', method: 'POST', openapiPath: '/device/v1/publications', fastifyUrl: '/device/v1/publications' },
  { operationId: 'quizSyncClosePublication', method: 'POST', openapiPath: '/device/v1/publications/{publicationId}/close', fastifyUrl: '/device/v1/publications/:publicationId/close' },
  { operationId: 'resolveJoinCode', method: 'GET', openapiPath: '/join-codes/{joinCode}', fastifyUrl: '/api/student/v1/join-codes/:joinCode' },
  { operationId: 'registerParticipant', method: 'POST', openapiPath: '/quiz-sessions/{quizSessionId}/participants', fastifyUrl: '/api/student/v1/quiz-sessions/:quizSessionId/participants' },
  { operationId: 'submitAnswer', method: 'POST', openapiPath: '/publications/{publicationId}/answers', fastifyUrl: '/api/student/v1/publications/:publicationId/answers' },
];

const EXPECTED_STUDENT_EVENT_NAMES = ['quiz.question', 'quiz.result', 'quiz.participant', 'quiz.session'];
const EXPECTED_DEVICE_SERVER_MESSAGE_NAMES = ['sync.answers', 'sync.participants', 'sync.heartbeat'];

/**
 * Closed route tree for the built app: exactly the seven D-owned REST
 * routes, `/healthz`, the two contracted WS upgrade paths, and the
 * `@fastify/cors` preflight wildcard. Any extra branch — an accidental
 * projector/leaderboard endpoint, a stray debug route — fails this literal
 * comparison outright; the Step 7 repository-diff check separately proves
 * `contracts/` itself stayed unchanged.
 */
const EXPECTED_ROUTE_TREE = `└── (empty root node)
    ├── /
    │   ├── healthz (GET, HEAD)
    │   ├── device/v1/
    │   │   ├── quiz-sessions (POST)
    │   │   │   └── /
    │   │   │       └── :quizSessionId
    │   │   │           └── /close (POST)
    │   │   └── publications (POST)
    │   │       └── /
    │   │           └── :publicationId
    │   │               └── /close (POST)
    │   └── api/
    │       ├── student/v1/
    │       │   ├── join-codes/
    │       │   │   └── :joinCode (GET, HEAD)
    │       │   ├── quiz-sessions/
    │       │   │   └── :quizSessionId
    │       │   │       └── /participants (POST)
    │       │   ├── publications/
    │       │   │   └── :publicationId
    │       │   │       └── /answers (POST)
    │       │   └── stream (GET, HEAD)
    │       └── device/v1/stream (GET, HEAD)
    └── * (OPTIONS)
`;

function collectOperationIds(doc: unknown): Map<string, { method: string; path: string }> {
  const paths = (doc as { paths?: Record<string, Record<string, { operationId?: string }>> }).paths ?? {};
  const found = new Map<string, { method: string; path: string }>();
  for (const [pathKey, methods] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (operation && typeof operation === 'object' && typeof operation.operationId === 'string') {
        found.set(operation.operationId, { method: method.toUpperCase(), path: pathKey });
      }
    }
  }
  return found;
}

describe('D-11: exact D ownership gate', () => {
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
      const routeConfig = request.routeOptions.config as { operationId?: string };
      if (routeConfig.operationId !== undefined) matchedOperationIds.push(routeConfig.operationId);
    });

    deviceId = ulid();
    await app.sql`
      INSERT INTO devices (device_id, credential_hash, hall_display_name, enabled, created_at)
      VALUES (${deviceId}, ${await hashDeviceCredential(DEVICE_TOKEN)}, 'Ownership Hall', true, now())
    `;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  describe('contract declarations', () => {
    const openapi = parseYaml(readFileSync(OPENAPI_PATH, 'utf8'));
    const quizApp = parseYaml(readFileSync(QUIZ_APP_PATH, 'utf8'));
    const openapiOps = collectOperationIds(openapi);
    const quizAppOps = collectOperationIds(quizApp);

    it('openapi.yaml declares exactly the four D-owned quiz-sync operations at their exact method/path', () => {
      const expectedDeviceOps = EXPECTED_OPERATIONS.filter((op) => op.fastifyUrl.startsWith('/device/'));
      expect(expectedDeviceOps).toHaveLength(4);
      for (const op of expectedDeviceOps) {
        expect(openapiOps.get(op.operationId)).toEqual({ method: op.method, path: op.openapiPath });
      }
    });

    it('quiz-app.yaml declares exactly the three D-owned student operations, once each', () => {
      const expectedStudentOps = EXPECTED_OPERATIONS.filter((op) => op.fastifyUrl.startsWith('/api/student/'));
      expect(expectedStudentOps).toHaveLength(3);
      expect([...quizAppOps.keys()].sort()).toEqual(expectedStudentOps.map((op) => op.operationId).sort());
      for (const op of expectedStudentOps) {
        expect(quizAppOps.get(op.operationId)).toEqual({ method: op.method, path: op.openapiPath });
      }
    });

    it('the four quiz-sync operationIds are exactly SERVER_SIDE_ONLY_OPERATION_IDS, disjoint from PANEL_OPERATION_IDS', () => {
      const deviceOpIds = EXPECTED_OPERATIONS.filter((op) => op.fastifyUrl.startsWith('/device/')).map((op) => op.operationId);
      expect([...SERVER_SIDE_ONLY_OPERATION_IDS].sort()).toEqual(deviceOpIds.sort());
      const overlap = deviceOpIds.filter((id) => (PANEL_OPERATION_IDS as readonly string[]).includes(id));
      expect(overlap).toEqual([]);
    });

    it('none of the three student operationIds appear in PANEL_OPERATION_IDS', () => {
      const studentOpIds = EXPECTED_OPERATIONS.filter((op) => op.fastifyUrl.startsWith('/api/student/')).map((op) => op.operationId);
      const overlap = studentOpIds.filter((id) => (PANEL_OPERATION_IDS as readonly string[]).includes(id));
      expect(overlap).toEqual([]);
    });
  });

  describe('route surface', () => {
    it('the built app exposes exactly the seven D routes plus /healthz and the two WS upgrade paths — nothing else', () => {
      expect(app.printRoutes()).toBe(EXPECTED_ROUTE_TREE);
    });
  });

  describe('every REST operation routes to exactly its own operationId', () => {
    it('quizSyncCreateSession: POST /device/v1/quiz-sessions', async () => {
      matchedOperationIds.length = 0;
      const response = await app.inject({
        method: 'POST',
        url: '/device/v1/quiz-sessions',
        headers: { authorization: `Bearer ${DEVICE_TOKEN}` },
        payload: { lectureSessionId: ulid(), deviceId, hallDisplayName: 'Ownership Hall' },
      });
      expect(response.statusCode).toBe(201);
      expect(matchedOperationIds).toEqual(['quizSyncCreateSession']);
      expect(() => zQuizSessionCreateResponse.parse(response.json())).not.toThrow();

      matchedOperationIds.length = 0;
      const unauthenticated = await app.inject({ method: 'POST', url: '/device/v1/quiz-sessions', payload: {} });
      expect(unauthenticated.statusCode).toBe(401);
      expect(matchedOperationIds).toEqual(['quizSyncCreateSession']);
      expect(() => zProblem.parse(unauthenticated.json())).not.toThrow();
    });

    it('quizSyncCloseSession: POST /device/v1/quiz-sessions/:quizSessionId/close', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/device/v1/quiz-sessions',
        headers: { authorization: `Bearer ${DEVICE_TOKEN}` },
        payload: { lectureSessionId: ulid(), deviceId, hallDisplayName: 'Ownership Hall' },
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

      matchedOperationIds.length = 0;
      const unauthenticated = await app.inject({ method: 'POST', url: `/device/v1/quiz-sessions/${quizSessionId}/close` });
      expect(unauthenticated.statusCode).toBe(401);
      expect(matchedOperationIds).toEqual(['quizSyncCloseSession']);
      expect(() => zProblem.parse(unauthenticated.json())).not.toThrow();
    });

    it('quizSyncPublish: POST /device/v1/publications', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/device/v1/quiz-sessions',
        headers: { authorization: `Bearer ${DEVICE_TOKEN}` },
        payload: { lectureSessionId: ulid(), deviceId, hallDisplayName: 'Ownership Hall' },
      });
      const { id: quizSessionId } = created.json() as { id: string };
      const optionA = ulid();
      const optionB = ulid();

      matchedOperationIds.length = 0;
      const response = await app.inject({
        method: 'POST',
        url: '/device/v1/publications',
        headers: { authorization: `Bearer ${DEVICE_TOKEN}` },
        payload: {
          publicationId: ulid(),
          quizSessionId,
          questionId: ulid(),
          prompt: 'Ownership gate question',
          options: [
            { id: optionA, label: 'A', text: 'One' },
            { id: optionB, label: 'B', text: 'Two' },
          ],
          correctOptionId: optionA,
          publishedAt: new Date().toISOString(),
        },
      });
      expect(response.statusCode).toBe(201);
      expect(matchedOperationIds).toEqual(['quizSyncPublish']);

      matchedOperationIds.length = 0;
      const invalidCorrectOption = await app.inject({
        method: 'POST',
        url: '/device/v1/publications',
        headers: { authorization: `Bearer ${DEVICE_TOKEN}` },
        payload: {
          publicationId: ulid(),
          quizSessionId,
          questionId: ulid(),
          prompt: 'Ownership gate question 2',
          options: [
            { id: optionA, label: 'A', text: 'One' },
            { id: optionB, label: 'B', text: 'Two' },
          ],
          correctOptionId: ulid(),
          publishedAt: new Date().toISOString(),
        },
      });
      expect(invalidCorrectOption.statusCode).toBe(422);
      expect(matchedOperationIds).toEqual(['quizSyncPublish']);
      expect(() => zProblem.parse(invalidCorrectOption.json())).not.toThrow();
    });

    it('quizSyncClosePublication: POST /device/v1/publications/:publicationId/close', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/device/v1/quiz-sessions',
        headers: { authorization: `Bearer ${DEVICE_TOKEN}` },
        payload: { lectureSessionId: ulid(), deviceId, hallDisplayName: 'Ownership Hall' },
      });
      const { id: quizSessionId } = created.json() as { id: string };
      const publicationId = ulid();
      const optionA = ulid();
      await app.inject({
        method: 'POST',
        url: '/device/v1/publications',
        headers: { authorization: `Bearer ${DEVICE_TOKEN}` },
        payload: {
          publicationId,
          quizSessionId,
          questionId: ulid(),
          prompt: 'Ownership gate question 3',
          options: [{ id: optionA, label: 'A', text: 'One' }, { id: ulid(), label: 'B', text: 'Two' }],
          correctOptionId: optionA,
          publishedAt: new Date().toISOString(),
        },
      });

      matchedOperationIds.length = 0;
      const response = await app.inject({
        method: 'POST',
        url: `/device/v1/publications/${publicationId}/close`,
        headers: { authorization: `Bearer ${DEVICE_TOKEN}` },
        payload: { publicationId, closedAt: new Date().toISOString(), closeReason: 'lecturer-closed' },
      });
      expect(response.statusCode).toBe(204);
      expect(matchedOperationIds).toEqual(['quizSyncClosePublication']);

      matchedOperationIds.length = 0;
      const mismatched = await app.inject({
        method: 'POST',
        url: `/device/v1/publications/${publicationId}/close`,
        headers: { authorization: `Bearer ${DEVICE_TOKEN}` },
        payload: { publicationId: ulid(), closedAt: new Date().toISOString(), closeReason: 'lecturer-closed' },
      });
      expect(mismatched.statusCode).toBe(422);
      expect(matchedOperationIds).toEqual(['quizSyncClosePublication']);
      expect(() => zProblem.parse(mismatched.json())).not.toThrow();
    });

    it('resolveJoinCode: GET /api/student/v1/join-codes/:joinCode', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/device/v1/quiz-sessions',
        headers: { authorization: `Bearer ${DEVICE_TOKEN}` },
        payload: { lectureSessionId: ulid(), deviceId, hallDisplayName: 'Ownership Hall' },
      });
      const { joinCode } = created.json() as { joinCode: string };

      matchedOperationIds.length = 0;
      const response = await app.inject({ method: 'GET', url: `/api/student/v1/join-codes/${joinCode}` });
      expect(response.statusCode).toBe(200);
      expect(matchedOperationIds).toEqual(['resolveJoinCode']);
      expect(() => zResolveJoinCodeResponse.parse(response.json())).not.toThrow();

      matchedOperationIds.length = 0;
      const notFound = await app.inject({ method: 'GET', url: '/api/student/v1/join-codes/ZZZZZZ' });
      expect(notFound.statusCode).toBe(404);
      expect(matchedOperationIds).toEqual(['resolveJoinCode']);
      expect(() => zQuizAppProblem.parse(notFound.json())).not.toThrow();
    });

    it('registerParticipant: POST /api/student/v1/quiz-sessions/:quizSessionId/participants', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/device/v1/quiz-sessions',
        headers: { authorization: `Bearer ${DEVICE_TOKEN}` },
        payload: { lectureSessionId: ulid(), deviceId, hallDisplayName: 'Ownership Hall' },
      });
      const { id: quizSessionId } = created.json() as { id: string };

      matchedOperationIds.length = 0;
      const response = await app.inject({
        method: 'POST',
        url: `/api/student/v1/quiz-sessions/${quizSessionId}/participants`,
        payload: { studentIdNumber: 'IT0000099', fullName: 'Ownership Student' },
      });
      expect(response.statusCode).toBe(200);
      expect(matchedOperationIds).toEqual(['registerParticipant']);
      expect(() => zRegisterParticipantResponse.parse(response.json())).not.toThrow();

      matchedOperationIds.length = 0;
      const invalid = await app.inject({
        method: 'POST',
        url: `/api/student/v1/quiz-sessions/${quizSessionId}/participants`,
        payload: { studentIdNumber: 'not-a-valid-id', fullName: 'Ownership Student' },
      });
      expect(invalid.statusCode).toBe(422);
      expect(matchedOperationIds).toEqual(['registerParticipant']);
      expect(() => zQuizAppProblem.parse(invalid.json())).not.toThrow();
    });

    it('submitAnswer: POST /api/student/v1/publications/:publicationId/answers', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/device/v1/quiz-sessions',
        headers: { authorization: `Bearer ${DEVICE_TOKEN}` },
        payload: { lectureSessionId: ulid(), deviceId, hallDisplayName: 'Ownership Hall' },
      });
      const { id: quizSessionId } = created.json() as { id: string };
      const publicationId = ulid();
      const optionA = ulid();
      await app.inject({
        method: 'POST',
        url: '/device/v1/publications',
        headers: { authorization: `Bearer ${DEVICE_TOKEN}` },
        payload: {
          publicationId,
          quizSessionId,
          questionId: ulid(),
          prompt: 'Ownership gate answer question',
          options: [{ id: optionA, label: 'A', text: 'One' }, { id: ulid(), label: 'B', text: 'Two' }],
          correctOptionId: optionA,
          publishedAt: new Date().toISOString(),
        },
      });
      const registered = await app.inject({
        method: 'POST',
        url: `/api/student/v1/quiz-sessions/${quizSessionId}/participants`,
        payload: { studentIdNumber: 'IT0000098', fullName: 'Ownership Student Two' },
      });
      const cookie = registered.cookies.find((c) => c.name === 'eduscope_participant')!;

      matchedOperationIds.length = 0;
      const response = await app.inject({
        method: 'POST',
        url: `/api/student/v1/publications/${publicationId}/answers`,
        cookies: { [cookie.name]: cookie.value },
        payload: { selectedOptionId: optionA },
      });
      expect(response.statusCode).toBe(200);
      expect(matchedOperationIds).toEqual(['submitAnswer']);
      expect(() => zSubmitAnswerResponse.parse(response.json())).not.toThrow();

      matchedOperationIds.length = 0;
      const unauthenticated = await app.inject({
        method: 'POST',
        url: `/api/student/v1/publications/${publicationId}/answers`,
        payload: { selectedOptionId: optionA },
      });
      expect(unauthenticated.statusCode).toBe(409);
      expect(matchedOperationIds).toEqual(['submitAnswer']);
      expect(() => zQuizAppProblem.parse(unauthenticated.json())).not.toThrow();
    });
  });

  describe('closed wire-message catalogs', () => {
    it('exactly four student event names, every union member parses through zStudentServerEvent', () => {
      const names = zStudentServerEvent.options.map((option) => option.shape.event.value);
      expect(names.sort()).toEqual([...EXPECTED_STUDENT_EVENT_NAMES].sort());

      expect(() =>
        zStudentServerEvent.parse({ event: 'quiz.question', payload: { state: 'none' } }),
      ).not.toThrow();
      expect(() =>
        zStudentServerEvent.parse({
          event: 'quiz.result',
          payload: {
            publicationId: ulid(),
            question: { prompt: 'p', options: [{ id: ulid(), label: 'A', text: 'a' }, { id: ulid(), label: 'B', text: 'b' }] },
            selectedOptionId: null,
            isCorrect: null,
            correctOptionId: ulid(),
            pointsAwarded: 0,
            runningScore: 0,
            ownRank: null,
            rankState: 'current',
          },
        }),
      ).not.toThrow();
      expect(() =>
        zStudentServerEvent.parse({ event: 'quiz.participant', payload: { connectionState: 'online' } }),
      ).not.toThrow();
      expect(() =>
        zStudentServerEvent.parse({ event: 'quiz.session', payload: { state: 'open' } }),
      ).not.toThrow();
    });

    it('exactly three D-owned device server message names, every union member parses through zQuizSyncServerMessage', () => {
      const names = zQuizSyncServerMessage.options.map((option) => option.shape.type.value);
      expect(names.sort()).toEqual([...EXPECTED_DEVICE_SERVER_MESSAGE_NAMES].sort());

      expect(() =>
        zQuizSyncServerMessage.parse({ type: 'sync.answers', quizSessionId: ulid(), answers: [] }),
      ).not.toThrow();
      expect(() =>
        zQuizSyncServerMessage.parse({ type: 'sync.participants', quizSessionId: ulid(), joinedCount: 0, onlineCount: 0 }),
      ).not.toThrow();
      expect(() =>
        zQuizSyncServerMessage.parse({ type: 'sync.heartbeat', at: new Date().toISOString() }),
      ).not.toThrow();
    });

    it('the client-emitted union stays B-owned sync.hello plus the shared bidirectional sync.heartbeat only', () => {
      const names = zQuizSyncClientMessage.options.map((option) => option.shape.type.value);
      expect(names.sort()).toEqual(['sync.heartbeat', 'sync.hello']);
    });
  });
});
