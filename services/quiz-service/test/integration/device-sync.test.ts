import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { createInterface, type Interface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { ulid } from 'ulidx';
import WebSocket from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { hashDeviceCredential } from '../../src/device/credentials.js';
import { replayAnswers, type DeviceAnswerRow } from '../../src/device/replay.js';
import { SystemClock } from '../../src/lib/clock.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { startTestPostgres, type TestPostgres } from '../helpers/postgres.js';

/**
 * D-08: the first final-verification task from the master plan — real B
 * (`services/core-api`) driven against real D (this package's own
 * `buildApp`), both over real PostgreSQL/HTTP/WS.
 *
 * Real B runs as its own OS process (`quiz-sync-process-entry.ts`, spawned
 * via `tsx`), not imported in-process. Two independent problems block a
 * direct import: `services/quiz-service/tsconfig.json`'s `rootDir` rejects
 * any source file outside this package (cascades across core-api's entire
 * dependency graph), and core-api's and quiz-service's `declare module
 * 'fastify'` augmentations of `FastifyInstance.db` are structurally
 * incompatible (`QuizDb` vs. `DrizzleDb`) the moment both `app.ts` modules
 * land in one TypeScript program. Running B as a separate process sidesteps
 * both: every interaction after boot crosses real HTTP/WS, not a shared
 * compilation. B also runs on its own real `SystemClock` (not a fake) —
 * every timing assertion below is a real wall-clock wait, not a simulated
 * one. The only test-only seam is D's `deviceUpgradeAllowed` (see
 * `src/device/stream.ts`), which simulates the device stream becoming
 * unavailable without adding a production admin/fault endpoint.
 */

const DEVICE_ID = ulid();
const DEVICE_BEARER = `d08-device-bearer-${randomUUID()}`;
const HALL_DISPLAY_NAME = 'Lecture Hall 1';

const CORE_API_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../core-api');
const TSX_BIN = join(CORE_API_DIR, 'node_modules/.bin/tsx');
const B_ENTRY_SCRIPT = join(CORE_API_DIR, 'test/peers/quiz-sync-process-entry.ts');

interface HelloFrame {
  type: 'sync.hello';
  deviceId: string;
  quizSessionId: string;
  answerWatermark: number;
}

interface BReadyLine {
  type: 'ready';
  baseUrl: string;
  ownerToken: string;
}

interface BProcess {
  baseUrl: string;
  ownerToken: string;
  stop(): Promise<void>;
}

interface BAnswerProjection {
  id: string;
  publicationId: string;
  studentIdNumber: string;
  studentDisplayName: string;
  selectedOptionId: string;
  isCorrect: boolean;
  responseTimeMs: number;
  submittedAt: string;
}

interface BPublication {
  id: string;
  state: string;
  question: { id: string; prompt: string; options: Array<{ id: string; label: string; text: string }> };
}

/** Spawns real B (`services/core-api`) as its own process and waits for its one-line JSON readiness signal. */
async function startBProcess(env: Record<string, string>): Promise<BProcess> {
  const child = spawn(TSX_BIN, [B_ENTRY_SCRIPT], {
    cwd: CORE_API_DIR,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stderrChunks: string[] = [];
  child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk.toString('utf8')));
  const rl: Interface = createInterface({ input: child.stdout });

  const ready = await new Promise<BReadyLine>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`quiz-sync-process-entry: timed out waiting for ready\nstderr:\n${stderrChunks.join('')}`));
    }, 30_000);
    rl.on('line', (line: string) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        return;
      }
      const message = parsed as { type?: string; message?: string };
      if (message.type === 'ready') {
        clearTimeout(timer);
        resolve(parsed as BReadyLine);
      } else if (message.type === 'error') {
        clearTimeout(timer);
        reject(new Error(`quiz-sync-process-entry: ${message.message ?? 'unknown error'}`));
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`quiz-sync-process-entry exited early with code ${String(code)}\nstderr:\n${stderrChunks.join('')}`));
    });
  });

  return {
    baseUrl: ready.baseUrl,
    ownerToken: ready.ownerToken,
    async stop() {
      if (child.exitCode !== null) return;
      child.kill('SIGTERM');
      await new Promise<void>((resolve) => child.once('exit', () => resolve()));
      rl.close();
    },
  };
}

async function bFetch(b: BProcess, method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${b.baseUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${b.ownerToken}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function bGetJson<T>(b: BProcess, path: string): Promise<T> {
  const response = await bFetch(b, 'GET', path);
  if (response.status !== 200) throw new Error(`device-sync: GET ${path} returned ${String(response.status)}: ${await response.text()}`);
  return (await response.json()) as T;
}

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 8000, pollMs = 50): Promise<void> {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error('device-sync: waitFor condition not met in time');
    await delay(pollMs);
  }
}

function extractParticipantCookie(response: Response): string {
  const setCookie = response.headers.getSetCookie().find((value) => value.startsWith('eduscope_participant='));
  const match = setCookie ? /^eduscope_participant=([^;]+)/.exec(setCookie) : null;
  if (!match) throw new Error('device-sync: registration response carried no eduscope_participant cookie');
  return `eduscope_participant=${match[1]}`;
}

async function registerStudent(quizBaseUrl: string, quizSessionId: string, studentIdNumber: string, fullName: string): Promise<string> {
  const response = await fetch(`${quizBaseUrl}/api/student/v1/quiz-sessions/${quizSessionId}/participants`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ studentIdNumber, fullName }),
  });
  if (response.status !== 200) throw new Error(`device-sync: registerStudent(${studentIdNumber}) returned ${String(response.status)}: ${await response.text()}`);
  return extractParticipantCookie(response);
}

function openStudentSocket(quizBaseUrl: string, cookie: string): Promise<WebSocket> {
  const wsUrl = `${quizBaseUrl.replace(/^http/, 'ws')}/api/student/v1/stream`;
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl, { headers: { cookie } });
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

async function submitAnswer(quizBaseUrl: string, cookie: string, publicationId: string, selectedOptionId: string): Promise<{ outcome: string; selectedOptionId: string }> {
  const response = await fetch(`${quizBaseUrl}/api/student/v1/publications/${publicationId}/answers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ selectedOptionId }),
  });
  if (response.status !== 200) throw new Error(`device-sync: submitAnswer returned ${String(response.status)}: ${await response.text()}`);
  return (await response.json()) as { outcome: string; selectedOptionId: string };
}

/** Publishes one question through real B's own REST flow (create -> list -> send-to-projector -> list publications), returning D-owned publicationId/option ids. */
async function publishQuestionViaB(b: BProcess, lectureSessionId: string, prompt: string): Promise<{ publicationId: string; optionAId: string; optionBId: string }> {
  const create = await bFetch(b, 'POST', '/api/v1/ai/questions', { prompt, options: [{ text: '3', isCorrect: false }, { text: '4', isCorrect: true }] });
  if (create.status !== 202) throw new Error(`device-sync: create question returned ${String(create.status)}: ${await create.text()}`);

  const questions = await bGetJson<{ items: Array<{ id: string; prompt: string; options: Array<{ id: string }> }> }>(b, `/api/v1/ai/questions?sessionId=${lectureSessionId}`);
  const question = questions.items.find((item) => item.prompt === prompt);
  if (!question) throw new Error(`device-sync: question "${prompt}" not found after create`);

  const send = await bFetch(b, 'POST', `/api/v1/ai/questions/${question.id}/send-to-projector`);
  if (send.status !== 202) throw new Error(`device-sync: send-to-projector returned ${String(send.status)}: ${await send.text()}`);

  await waitFor(async () => {
    const publications = await bGetJson<{ items: BPublication[] }>(b, `/api/v1/ai/publications?sessionId=${lectureSessionId}`);
    // 'open' — not just present — since the row is inserted (state:'publishing') before the real D
    // publish REST call completes; submitting an answer against a not-yet-open publication 409s.
    return publications.items.some((item) => item.question.id === question.id && item.state === 'open');
  });
  const publications = await bGetJson<{ items: BPublication[] }>(b, `/api/v1/ai/publications?sessionId=${lectureSessionId}`);
  const publication = publications.items.find((item) => item.question.id === question.id)!;
  return { publicationId: publication.id, optionAId: publication.question.options[0]!.id, optionBId: publication.question.options[1]!.id };
}

async function bPublicationResponses(b: BProcess, publicationId: string): Promise<{ items: BAnswerProjection[]; stale: boolean }> {
  return bGetJson(b, `/api/v1/quiz/publications/${publicationId}/responses`);
}

interface Ctx {
  pg: TestPostgres;
  app: FastifyInstance;
  quizBaseUrl: string;
  gate: { open: boolean };
  helloFrames: HelloFrame[];
  deviceConnection: { current: WebSocket | undefined };
}

describe('D-08: real B + real D quiz-sync convergence (DR-22)', () => {
  let ctx: Ctx;
  let b: BProcess;

  beforeAll(async () => {
    const pg = await startTestPostgres();
    const config = loadConfig({ NODE_ENV: 'test', QUIZ_SERVICE_DATABASE_URL: pg.connectionString, QUIZ_SERVICE_HOST: '127.0.0.1' });
    const gate = { open: true };

    const app = await buildApp({ config, clock: new SystemClock(), ids: new UlidGenerator(), deviceUpgradeAllowed: () => gate.open });
    await app.sql`
      INSERT INTO devices (device_id, credential_hash, hall_display_name, enabled, created_at)
      VALUES (${DEVICE_ID}, ${await hashDeviceCredential(DEVICE_BEARER)}, ${HALL_DISPLAY_NAME}, true, now())
    `;
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address() as AddressInfo;
    const quizBaseUrl = `http://127.0.0.1:${String(address.port)}`;

    const helloFrames: HelloFrame[] = [];
    const deviceConnection: { current: WebSocket | undefined } = { current: undefined };
    app.websocketServer.on('connection', (socket: WebSocket, request) => {
      if (request.url !== '/api/device/v1/stream') return;
      deviceConnection.current = socket;
      socket.on('message', (data: WebSocket.RawData) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(data.toString());
        } catch {
          return;
        }
        if ((parsed as { type?: string }).type === 'sync.hello') helloFrames.push(parsed as HelloFrame);
      });
    });

    ctx = { pg, app, quizBaseUrl, gate, helloFrames, deviceConnection };

    b = await startBProcess({ D08_QUIZ_SERVICE_BASE_URL: quizBaseUrl, D08_QUIZ_DEVICE_ID: DEVICE_ID, D08_QUIZ_DEVICE_BEARER: DEVICE_BEARER });
  }, 90_000);

  afterAll(async () => {
    await b?.stop();
    await ctx.app.close();
    await ctx.pg.stop();
  });

  it(
    'drives one recording-start -> answers -> link-cut -> stale -> failed -> recover -> replay cycle against real B and real D',
    async () => {
      // 1. B recording start creates the real D quiz session and opens sync.hello{watermark:0}.
      const startResponse = await bFetch(b, 'POST', '/api/v1/recording/start');
      expect(startResponse.status).toBe(202);
      await waitFor(async () => (await bGetJson<{ state: string }>(b, '/api/v1/recording/state')).state === 'recording');
      const lectureSessionId = (await bGetJson<{ sessionId: string }>(b, '/api/v1/recording/state')).sessionId;

      await waitFor(async () => (await bGetJson<{ state: string; quizSessionId: string | null }>(b, '/api/v1/quiz/session')).state === 'open');
      const quizSessionId = (await bGetJson<{ quizSessionId: string }>(b, '/api/v1/quiz/session')).quizSessionId;

      await waitFor(() => ctx.helloFrames.length === 1);
      expect(ctx.helloFrames[0]).toMatchObject({ type: 'sync.hello', deviceId: DEVICE_ID, quizSessionId, answerWatermark: 0 });

      // 2. Register three real student participants and open three real student sockets.
      const cookieA = await registerStudent(ctx.quizBaseUrl, quizSessionId, 'IT0000001', 'Student A');
      const cookieB = await registerStudent(ctx.quizBaseUrl, quizSessionId, 'IT0000002', 'Student B');
      const cookieC = await registerStudent(ctx.quizBaseUrl, quizSessionId, 'IT0000003', 'Student C');
      const socketA = await openStudentSocket(ctx.quizBaseUrl, cookieA);
      const socketB = await openStudentSocket(ctx.quizBaseUrl, cookieB);
      const socketC = await openStudentSocket(ctx.quizBaseUrl, cookieC);

      // publish through B (real REST call, D-owned quizSyncPublish), submit two real answers.
      const q1 = await publishQuestionViaB(b, lectureSessionId, 'D-08 Q1');
      const answerA1 = await submitAnswer(ctx.quizBaseUrl, cookieA, q1.publicationId, q1.optionAId);
      const answerB1 = await submitAnswer(ctx.quizBaseUrl, cookieB, q1.publicationId, q1.optionBId);
      expect(answerA1.outcome).toBe('accepted');
      expect(answerB1.outcome).toBe('accepted');

      // 3. Wait for B's projections (public listPublicationResponses — the durable answerWatermark itself is
      // internal/never echoed, INV-AP-1) and exact joined count 3.
      await waitFor(async () => (await bPublicationResponses(b, q1.publicationId)).items.length === 2);
      await waitFor(async () => (await bGetJson<{ joinedCount: number }>(b, '/api/v1/quiz/session')).joinedCount === 3);

      // 4. Put D's device-stream test gate offline and terminate the active device socket;
      // wait past T-QUIZ-SYNC-STALE (real time — B runs its own real SystemClock) and assert stale,
      // rows retained, recording still recording.
      ctx.gate.open = false;
      ctx.deviceConnection.current?.terminate();
      await waitFor(async () => (await bGetJson<{ syncState: string | null }>(b, '/api/v1/quiz/session')).syncState === 'stale', 25_000, 250);
      expect((await bPublicationResponses(b, q1.publicationId)).stale).toBe(true);
      expect((await bGetJson<{ state: string }>(b, '/api/v1/recording/state')).state).toBe('recording');

      // 5. Submit two more student answers on a second publication while B is disconnected; both succeed.
      const q2 = await publishQuestionViaB(b, lectureSessionId, 'D-08 Q2');
      const answerB2 = await submitAnswer(ctx.quizBaseUrl, cookieB, q2.publicationId, q2.optionAId);
      const answerC2 = await submitAnswer(ctx.quizBaseUrl, cookieC, q2.publicationId, q2.optionBId);
      expect(answerB2.outcome).toBe('accepted');
      expect(answerC2.outcome).toBe('accepted');

      // 6. Wait past T-QUIZ-SYNC-FAIL (real time); assert failed, recording untouched.
      await waitFor(async () => (await bGetJson<{ syncState: string | null }>(b, '/api/v1/quiz/session')).syncState === 'failed', 70_000, 500);
      expect((await bGetJson<{ state: string }>(b, '/api/v1/recording/state')).state).toBe('recording');

      // 7. Re-enable the D stream; B's own reconnect backoff (real time) brings a new hello with watermark 2.
      ctx.gate.open = true;
      await waitFor(() => ctx.helloFrames.length === 2, 40_000, 200);
      expect(ctx.helloFrames[1]).toMatchObject({ type: 'sync.hello', deviceId: DEVICE_ID, quizSessionId, answerWatermark: 2 });

      // 8. Assert B ingested the replayed seq 3/4 answers, syncState/joined count restore, heartbeat resumes.
      await waitFor(async () => (await bPublicationResponses(b, q2.publicationId)).items.length === 2);
      await waitFor(async () => (await bGetJson<{ syncState: string | null }>(b, '/api/v1/quiz/session')).syncState === 'synced');
      await waitFor(async () => (await bGetJson<{ joinedCount: number }>(b, '/api/v1/quiz/session')).joinedCount === 3);
      await delay(6_000); // past T-QUIZ-HEARTBEAT — confirm the reconnected socket's heartbeat keeps it synced
      expect((await bGetJson<{ syncState: string | null }>(b, '/api/v1/quiz/session')).syncState).toBe('synced');

      // 9. Deep-compare D's authoritative answers with B's projections field-by-field
      // (D-only studentId/pointsAwarded/quizSessionId/seq excluded), and assert no duplicate keys.
      const authoritative: DeviceAnswerRow[] = await replayAnswers(ctx.app.db, quizSessionId, 0);
      expect(authoritative).toHaveLength(4);

      const seenKeys = new Set<string>();
      for (const row of authoritative) {
        const key = `${row.publicationId}:${row.studentIdNumber}`;
        expect(seenKeys.has(key)).toBe(false);
        seenKeys.add(key);
      }

      const [q1Responses, q2Responses] = await Promise.all([bPublicationResponses(b, q1.publicationId), bPublicationResponses(b, q2.publicationId)]);
      const projections = [...q1Responses.items, ...q2Responses.items];
      expect(projections).toHaveLength(4);
      expect(new Set(projections.map((row) => row.id)).size).toBe(4); // no duplicate rows

      for (const row of authoritative) {
        const match = projections.find((projection) => projection.id === row.answerId);
        expect(match, `no B projection found for D answer ${row.answerId}`).toBeDefined();
        expect(match!.publicationId).toBe(row.publicationId);
        expect(match!.studentIdNumber).toBe(row.studentIdNumber);
        expect(match!.studentDisplayName).toBe(row.studentDisplayName);
        expect(match!.selectedOptionId).toBe(row.selectedOptionId);
        expect(match!.isCorrect).toBe(row.isCorrect);
        expect(match!.responseTimeMs).toBe(row.responseTimeMs);
        expect(match!.submittedAt).toBe(row.submittedAt);
      }

      socketA.close();
      socketB.close();
      socketC.close();
    },
    180_000,
  );
});
