import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { Writable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { ulid } from 'ulidx';
import WebSocket from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { hashDeviceCredential } from '../../src/device/credentials.js';
import { replayAnswers } from '../../src/device/replay.js';
import { SystemClock } from '../../src/lib/clock.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { startTestPostgres, type TestPostgres } from '../helpers/postgres.js';

/**
 * D-11 Step 3: the single executable happy-flow gate for the whole D
 * implementation. Real PostgreSQL, real D (`buildApp`), real HTTP/WS —
 * mirrors D-08's real-process/real-clock convention, not a simulated one.
 */

const HALL_A = 'Ownership Hall A';
const HALL_B = 'Ownership Hall B';

interface StudentFrame {
  event: string;
  payload: unknown;
  at: string;
  seq: number;
}

interface DeviceFrame {
  type: string;
  [key: string]: unknown;
}

interface StudentHandle {
  studentIdNumber: string;
  fullName: string;
  cookie: string;
  frames: StudentFrame[];
  socket: WebSocket;
}

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 8000, pollMs = 50): Promise<void> {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error('happy-flow: waitFor condition not met in time');
    await delay(pollMs);
  }
}

async function deviceFetch(
  baseUrl: string,
  bearer: string,
  method: string,
  urlPath: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      authorization: `Bearer ${bearer}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...extraHeaders,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

function extractParticipantSetCookie(response: Response): string {
  const setCookie = response.headers.getSetCookie().find((value) => value.startsWith('eduscope_participant='));
  if (!setCookie) throw new Error('happy-flow: registration response carried no eduscope_participant cookie');
  return setCookie;
}

function cookieHeaderFrom(setCookie: string): string {
  const match = /^eduscope_participant=([^;]+)/.exec(setCookie);
  if (!match) throw new Error('happy-flow: malformed set-cookie header');
  return `eduscope_participant=${match[1]}`;
}

async function registerStudent(
  quizBaseUrl: string,
  quizSessionId: string,
  studentIdNumber: string,
  fullName: string,
): Promise<{ response: Response; setCookie: string; cookie: string; body: { participantId: string; outcome: string } }> {
  const response = await fetch(`${quizBaseUrl}/api/student/v1/quiz-sessions/${quizSessionId}/participants`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ studentIdNumber, fullName }),
  });
  if (response.status !== 200) throw new Error(`happy-flow: register(${studentIdNumber}) returned ${String(response.status)}: ${await response.text()}`);
  const setCookie = extractParticipantSetCookie(response);
  const body = (await response.json()) as { participantId: string; outcome: string };
  return { response, setCookie, cookie: cookieHeaderFrom(setCookie), body };
}

function openStudentSocket(quizBaseUrl: string, cookie: string, frames: StudentFrame[]): Promise<WebSocket> {
  const wsUrl = `${quizBaseUrl.replace(/^http/, 'ws')}/api/student/v1/stream`;
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl, { headers: { cookie } });
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
    socket.on('message', (data: WebSocket.RawData) => {
      frames.push(JSON.parse(data.toString()) as StudentFrame);
    });
  });
}

function openDeviceSocket(
  quizBaseUrl: string,
  bearer: string,
  deviceId: string,
  quizSessionId: string,
  answerWatermark: number,
  frames: DeviceFrame[],
): Promise<WebSocket> {
  const wsUrl = `${quizBaseUrl.replace(/^http/, 'ws')}/api/device/v1/stream`;
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl, { headers: { authorization: `Bearer ${bearer}` } });
    socket.once('open', () => {
      socket.send(JSON.stringify({ type: 'sync.hello', deviceId, quizSessionId, answerWatermark }));
      resolve(socket);
    });
    socket.once('error', reject);
    socket.on('message', (data: WebSocket.RawData) => {
      frames.push(JSON.parse(data.toString()) as DeviceFrame);
    });
  });
}

async function submitAnswer(
  quizBaseUrl: string,
  cookie: string,
  publicationId: string,
  selectedOptionId: string,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${quizBaseUrl}/api/student/v1/publications/${publicationId}/answers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ selectedOptionId }),
  });
  return { status: response.status, body: await response.json() };
}

interface PublishedQuestion {
  publicationId: string;
  optionCorrectId: string;
  optionWrongId: string;
  prompt: string;
}

async function publishQuestion(
  quizBaseUrl: string,
  bearer: string,
  quizSessionId: string,
  prompt: string,
): Promise<PublishedQuestion> {
  const optionCorrectId = ulid();
  const optionWrongId = ulid();
  const publicationId = ulid();
  const response = await deviceFetch(quizBaseUrl, bearer, 'POST', '/device/v1/publications', {
    publicationId,
    quizSessionId,
    questionId: ulid(),
    prompt,
    options: [
      { id: optionCorrectId, label: 'A', text: 'Correct option' },
      { id: optionWrongId, label: 'B', text: 'Wrong option' },
    ],
    correctOptionId: optionCorrectId,
    publishedAt: new Date().toISOString(),
  });
  if (response.status !== 201) throw new Error(`happy-flow: publish returned ${String(response.status)}: ${await response.text()}`);
  return { publicationId, optionCorrectId, optionWrongId, prompt };
}

async function closePublication(quizBaseUrl: string, bearer: string, publicationId: string): Promise<Response> {
  return deviceFetch(quizBaseUrl, bearer, 'POST', `/device/v1/publications/${publicationId}/close`, {
    publicationId,
    closedAt: new Date().toISOString(),
    closeReason: 'lecturer-closed',
  });
}

describe('D-11: real D happy-flow gate', () => {
  let pg: TestPostgres;
  let app: FastifyInstance;
  let quizBaseUrl: string;
  let logLines: string[];

  const deviceAId = ulid();
  const deviceABearer = `happy-flow-device-a-${randomUUID()}`;
  const deviceBId = ulid();
  const deviceBBearer = `happy-flow-device-b-${randomUUID()}`;

  beforeAll(async () => {
    pg = await startTestPostgres();
    const config = loadConfig({ NODE_ENV: 'test', QUIZ_SERVICE_DATABASE_URL: pg.connectionString, QUIZ_SERVICE_HOST: '127.0.0.1' });

    logLines = [];
    const loggerStream = new Writable({
      write(chunk, _encoding, callback) {
        logLines.push(chunk.toString('utf8'));
        callback();
      },
    });

    app = await buildApp({ config, clock: new SystemClock(), ids: new UlidGenerator(), loggerStream });
    await app.sql`
      INSERT INTO devices (device_id, credential_hash, hall_display_name, enabled, created_at)
      VALUES (${deviceAId}, ${await hashDeviceCredential(deviceABearer)}, ${HALL_A}, true, now())
    `;
    await app.sql`
      INSERT INTO devices (device_id, credential_hash, hall_display_name, enabled, created_at)
      VALUES (${deviceBId}, ${await hashDeviceCredential(deviceBBearer)}, ${HALL_B}, true, now())
    `;
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address() as AddressInfo;
    quizBaseUrl = `http://127.0.0.1:${String(address.port)}`;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  it(
    'drives the full D-01..D-10 real happy path end to end',
    async () => {
      // ── 1. Two devices; one cannot access the other's session/publication ──
      const lectureA = ulid();
      const createA = await deviceFetch(quizBaseUrl, deviceABearer, 'POST', '/device/v1/quiz-sessions', {
        lectureSessionId: lectureA,
        deviceId: deviceAId,
        hallDisplayName: HALL_A,
      });
      expect(createA.status).toBe(201);
      const sessionA = (await createA.json()) as { id: string; joinCode: string; joinUrl: string };
      const quizSessionId = sessionA.id;

      // Device B cannot collide onto A's lecture.
      const collideAttempt = await deviceFetch(quizBaseUrl, deviceBBearer, 'POST', '/device/v1/quiz-sessions', {
        lectureSessionId: lectureA,
        deviceId: deviceBId,
        hallDisplayName: HALL_B,
      });
      expect(collideAttempt.status).toBe(409);

      // Device B cannot publish into A's session.
      const foreignOptionId = ulid();
      const foreignPublish = await deviceFetch(quizBaseUrl, deviceBBearer, 'POST', '/device/v1/publications', {
        publicationId: ulid(),
        quizSessionId,
        questionId: ulid(),
        prompt: 'foreign publish attempt',
        options: [{ id: foreignOptionId, label: 'A', text: 'x' }, { id: ulid(), label: 'B', text: 'y' }],
        correctOptionId: foreignOptionId,
        publishedAt: new Date().toISOString(),
      });
      expect(foreignPublish.status).toBe(409);

      // Device B's close of A's session silently no-ops; A's session stays open.
      const foreignClose = await deviceFetch(quizBaseUrl, deviceBBearer, 'POST', `/device/v1/quiz-sessions/${quizSessionId}/close`);
      expect(foreignClose.status).toBe(204);
      const stillOpen = await fetch(`${quizBaseUrl}/api/student/v1/join-codes/${sessionA.joinCode}`);
      expect(((await stillOpen.json()) as { state: string }).state).toBe('open');

      // ── 2. Idempotent create; mismatched contract header logs once, still succeeds ──
      const createAgain = await deviceFetch(quizBaseUrl, deviceABearer, 'POST', '/device/v1/quiz-sessions', {
        lectureSessionId: lectureA,
        deviceId: deviceAId,
        hallDisplayName: HALL_A,
      });
      expect(createAgain.status).toBe(201);
      expect(await createAgain.json()).toEqual(sessionA);

      logLines.length = 0;
      const createMismatch = await deviceFetch(
        quizBaseUrl,
        deviceABearer,
        'POST',
        '/device/v1/quiz-sessions',
        { lectureSessionId: lectureA, deviceId: deviceAId, hallDisplayName: HALL_A },
        { 'x-eduscope-contract': '0.9' },
      );
      expect(createMismatch.status).toBe(201);
      expect(await createMismatch.json()).toEqual(sessionA);
      const mismatchLogLines = logLines.filter((line) => line.includes('quiz-sync contract version mismatch'));
      expect(mismatchLogLines).toHaveLength(1);

      // ── 3. Resolve is case-insensitive and read-only; register three students, one rejoin ──
      const resolveLower = await fetch(`${quizBaseUrl}/api/student/v1/join-codes/${sessionA.joinCode.toLowerCase()}`);
      const resolveUpper = await fetch(`${quizBaseUrl}/api/student/v1/join-codes/${sessionA.joinCode.toUpperCase()}`);
      expect(resolveLower.status).toBe(200);
      expect(resolveUpper.status).toBe(200);
      expect(((await resolveLower.json()) as { participantState: string }).participantState).toBe('anonymous');

      const alpha = await registerStudent(quizBaseUrl, quizSessionId, 'IT0000001', 'Alpha Ownership');
      const bravo = await registerStudent(quizBaseUrl, quizSessionId, 'IT0000002', 'Bravo Ownership');
      const charlie = await registerStudent(quizBaseUrl, quizSessionId, 'IT0000003', 'Charlie Ownership');
      expect(alpha.body.outcome).toBe('created');
      expect(bravo.body.outcome).toBe('created');
      expect(charlie.body.outcome).toBe('created');

      const alphaRejoin = await registerStudent(quizBaseUrl, quizSessionId, 'IT0000001', 'Alpha Ownership');
      expect(alphaRejoin.body.outcome).toBe('rejoined');
      expect(alphaRejoin.body.participantId).toBe(alpha.body.participantId);

      for (const setCookie of [alpha.setCookie, bravo.setCookie, charlie.setCookie]) {
        expect(setCookie).toMatch(/Secure/i);
        expect(setCookie).toMatch(/HttpOnly/i);
        expect(setCookie).toMatch(/SameSite=Lax/i);
        expect(setCookie).toMatch(/Path=\/api\/student\/v1/);
      }

      // resolveJoinCode never echoes joined count (INV-QP-1) — confirmed via the device stream's own count instead, below.

      // ── 4. Connect the device socket and three student sockets; assert ordered snapshots and hello/participant frames ──
      const deviceFrames: DeviceFrame[] = [];
      const deviceSocket = await openDeviceSocket(quizBaseUrl, deviceABearer, deviceAId, quizSessionId, 0, deviceFrames);
      await waitFor(() => deviceFrames.length >= 1);
      expect(deviceFrames[0]).toMatchObject({ type: 'sync.participants', quizSessionId, joinedCount: 3, onlineCount: 0 });

      const students = {} as Record<'alpha' | 'bravo' | 'charlie', StudentHandle>;
      for (const [key, reg, studentIdNumber, fullName] of [
        ['alpha', alpha, 'IT0000001', 'Alpha Ownership'],
        ['bravo', bravo, 'IT0000002', 'Bravo Ownership'],
        ['charlie', charlie, 'IT0000003', 'Charlie Ownership'],
      ] as const) {
        const frames: StudentFrame[] = [];
        const socket = await openStudentSocket(quizBaseUrl, reg.cookie, frames);
        await waitFor(() => frames.length >= 3);
        expect(frames.map((f) => f.event)).toEqual(['quiz.session', 'quiz.participant', 'quiz.question']);
        expect(frames.map((f) => f.seq)).toEqual([0, 1, 2]);
        expect(frames[0]!.payload).toEqual({ state: 'open' });
        expect(frames[1]!.payload).toEqual({ connectionState: 'online' });
        expect(frames[2]!.payload).toEqual({ state: 'none' });
        students[key] = { studentIdNumber, fullName, cookie: reg.cookie, frames, socket };
      }

      await waitFor(async () => {
        const counts = deviceFrames.filter((f) => f.type === 'sync.participants').at(-1) as { onlineCount?: number } | undefined;
        return counts?.onlineCount === 3;
      }, 5_000);

      await waitFor(() => deviceFrames.some((f) => f.type === 'sync.heartbeat'), 7_000);

      // ── 5. Publish Q1; no correctness leaks before close; correct/incorrect/retry/race-order answers ──
      const q1 = await publishQuestion(quizBaseUrl, deviceABearer, quizSessionId, 'D-11 Q1');
      for (const key of ['alpha', 'bravo', 'charlie'] as const) {
        await waitFor(() => students[key].frames.some((f) => f.event === 'quiz.question' && (f.payload as { publicationId?: string }).publicationId === q1.publicationId));
        const openFrame = students[key].frames.find((f) => f.event === 'quiz.question' && (f.payload as { publicationId?: string }).publicationId === q1.publicationId)!;
        expect(JSON.stringify(openFrame.payload)).not.toMatch(/correctOptionId/);
      }

      const alphaCorrect = await submitAnswer(quizBaseUrl, students.alpha.cookie, q1.publicationId, q1.optionCorrectId);
      expect(alphaCorrect).toMatchObject({ status: 200, body: { outcome: 'accepted', selectedOptionId: q1.optionCorrectId } });

      const bravoIncorrect = await submitAnswer(quizBaseUrl, students.bravo.cookie, q1.publicationId, q1.optionWrongId);
      expect(bravoIncorrect).toMatchObject({ status: 200, body: { outcome: 'accepted', selectedOptionId: q1.optionWrongId } });

      // Retry with a different option: the already-accepted answer wins, never the retry's option.
      const alphaRetry = await submitAnswer(quizBaseUrl, students.alpha.cookie, q1.publicationId, q1.optionWrongId);
      expect(alphaRetry).toMatchObject({ status: 200, body: { outcome: 'already-accepted', selectedOptionId: q1.optionCorrectId } });

      // ── 6. Close Q1; private results/ranks fan out; device replay carries the two rows; publish Q2 after close, ordering proven ──
      const closeQ1 = await closePublication(quizBaseUrl, deviceABearer, q1.publicationId);
      expect(closeQ1.status).toBe(204);

      // Race order 2: an answer submitted after close is rejected, never accepted.
      const charlieTooLate = await submitAnswer(quizBaseUrl, students.charlie.cookie, q1.publicationId, q1.optionCorrectId);
      expect(charlieTooLate.status).toBe(409);

      for (const key of ['alpha', 'bravo', 'charlie'] as const) {
        await waitFor(() => students[key].frames.some((f) => f.event === 'quiz.result'));
      }
      const alphaResult = students.alpha.frames.find((f) => f.event === 'quiz.result')!.payload as { isCorrect: boolean; pointsAwarded: number };
      const bravoResult = students.bravo.frames.find((f) => f.event === 'quiz.result')!.payload as { isCorrect: boolean; pointsAwarded: number };
      const charlieResult = students.charlie.frames.find((f) => f.event === 'quiz.result')!.payload as { selectedOptionId: string | null; isCorrect: boolean | null };
      expect(alphaResult).toMatchObject({ isCorrect: true, pointsAwarded: 10 });
      expect(bravoResult).toMatchObject({ isCorrect: false, pointsAwarded: 0 });
      expect(charlieResult).toMatchObject({ selectedOptionId: null, isCorrect: null });

      await waitFor(() => {
        const answerFrames = deviceFrames.filter((f) => f.type === 'sync.answers') as unknown as Array<{ answers: Array<{ seq: number; publicationId: string }> }>;
        const seen = answerFrames.flatMap((f) => f.answers);
        return seen.filter((a) => a.publicationId === q1.publicationId).length === 2;
      }, 5_000);

      const q2 = await publishQuestion(quizBaseUrl, deviceABearer, quizSessionId, 'D-11 Q2');
      for (const key of ['alpha', 'bravo', 'charlie'] as const) {
        await waitFor(() => students[key].frames.some((f) => f.event === 'quiz.question' && (f.payload as { publicationId?: string }).publicationId === q2.publicationId));
        const resultIndex = students[key].frames.findIndex((f) => f.event === 'quiz.result');
        const q2OpenIndex = students[key].frames.findIndex(
          (f) => f.event === 'quiz.question' && (f.payload as { publicationId?: string }).publicationId === q2.publicationId,
        );
        expect(resultIndex).toBeGreaterThanOrEqual(0);
        expect(q2OpenIndex).toBeGreaterThan(resultIndex);
      }

      // ── 7. Disconnect device, accept answers while it's down, reconnect from the stored watermark, compare rows ──
      const watermarkBeforeDisconnect = (deviceFrames.filter((f) => f.type === 'sync.answers').at(-1) as unknown as { answers: Array<{ seq: number }> } | undefined)?.answers.at(-1)?.seq ?? 0;
      deviceSocket.terminate();
      await delay(200);

      const bravoQ2 = await submitAnswer(quizBaseUrl, students.bravo.cookie, q2.publicationId, q2.optionCorrectId);
      expect(bravoQ2).toMatchObject({ status: 200, body: { outcome: 'accepted' } });

      const deviceFrames2: DeviceFrame[] = [];
      const deviceSocket2 = await openDeviceSocket(quizBaseUrl, deviceABearer, deviceAId, quizSessionId, watermarkBeforeDisconnect, deviceFrames2);
      await waitFor(() => deviceFrames2.some((f) => f.type === 'sync.answers'));
      const replayedFrame = deviceFrames2.find((f) => f.type === 'sync.answers') as unknown as { answers: Array<{ seq: number; publicationId: string }> };
      expect(replayedFrame.answers).toHaveLength(1);
      expect(replayedFrame.answers[0]!.publicationId).toBe(q2.publicationId);

      const authoritative = await replayAnswers(app.db, quizSessionId, 0);
      expect(authoritative).toHaveLength(3);
      expect(new Set(authoritative.map((row) => row.seq)).size).toBe(3);

      // ── 8. Close Q2; disconnect/reconnect one student; the wholesale snapshot has no stale question/result ──
      const closeQ2 = await closePublication(quizBaseUrl, deviceABearer, q2.publicationId);
      expect(closeQ2.status).toBe(204);
      await waitFor(() => students.charlie.frames.some((f) => f.event === 'quiz.result' && (f.payload as { publicationId?: string }).publicationId === q2.publicationId));

      students.charlie.socket.close();
      const charlieReconnectFrames: StudentFrame[] = [];
      const charlieReconnectSocket = await openStudentSocket(quizBaseUrl, students.charlie.cookie, charlieReconnectFrames);
      await waitFor(() => charlieReconnectFrames.length >= 4);
      expect(charlieReconnectFrames.map((f) => f.event)).toEqual(['quiz.session', 'quiz.participant', 'quiz.question', 'quiz.result']);
      const reconnectQuestion = charlieReconnectFrames[2]!.payload as { publicationId: string; prompt: string; state: string };
      expect(reconnectQuestion.publicationId).toBe(q2.publicationId);
      expect(reconnectQuestion.prompt).toBe(q2.prompt);
      expect(reconnectQuestion.state).toBe('closed');
      students.charlie = { ...students.charlie, frames: charlieReconnectFrames, socket: charlieReconnectSocket };

      // ── 9. Close the quiz session twice; terminal participated/none variants; further register/answer calls are contracted Problems ──
      const closeSession = await deviceFetch(quizBaseUrl, deviceABearer, 'POST', `/device/v1/quiz-sessions/${quizSessionId}/close`);
      expect(closeSession.status).toBe(204);

      for (const key of ['alpha', 'bravo', 'charlie'] as const) {
        await waitFor(() => students[key].frames.some((f) => f.event === 'quiz.session' && (f.payload as { state?: string }).state === 'closed'));
      }
      const alphaTerminal = students.alpha.frames.find((f) => f.event === 'quiz.session' && (f.payload as { state?: string }).state === 'closed')!
        .payload as { participationState: string; finalScore: number; finalRank: number | null; answeredCount: number };
      const bravoTerminal = students.bravo.frames.find((f) => f.event === 'quiz.session' && (f.payload as { state?: string }).state === 'closed')!
        .payload as { participationState: string; finalScore: number; finalRank: number | null; answeredCount: number };
      const charlieTerminal = students.charlie.frames.find((f) => f.event === 'quiz.session' && (f.payload as { state?: string }).state === 'closed')!
        .payload as { participationState: string; finalScore: number; finalRank: number | null; answeredCount: number };

      expect(alphaTerminal).toMatchObject({ participationState: 'participated', finalScore: 10, finalRank: 1, answeredCount: 1 });
      expect(bravoTerminal).toMatchObject({ participationState: 'participated', finalScore: 10, finalRank: 1, answeredCount: 2 });
      expect(charlieTerminal).toMatchObject({ participationState: 'none', finalScore: 0, finalRank: null, answeredCount: 0 });

      const closeSessionAgain = await deviceFetch(quizBaseUrl, deviceABearer, 'POST', `/device/v1/quiz-sessions/${quizSessionId}/close`);
      expect(closeSessionAgain.status).toBe(204);

      const registerAfterClose = await fetch(`${quizBaseUrl}/api/student/v1/quiz-sessions/${quizSessionId}/participants`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ studentIdNumber: 'IT0000009', fullName: 'Too Late' }),
      });
      expect(registerAfterClose.status).toBe(409);

      const answerAfterClose = await submitAnswer(quizBaseUrl, students.charlie.cookie, q2.publicationId, q2.optionCorrectId);
      expect(answerAfterClose.status).toBe(409);

      deviceSocket2.close();

      // ── 10. Restart D against the same PostgreSQL database; reconnect; terminal state survives, no duplicates ──
      await app.close();
      const restartedConfig = loadConfig({ NODE_ENV: 'test', QUIZ_SERVICE_DATABASE_URL: pg.connectionString, QUIZ_SERVICE_HOST: '127.0.0.1' });
      const restarted = await buildApp({ config: restartedConfig, clock: new SystemClock(), ids: new UlidGenerator() });
      await restarted.listen({ host: '127.0.0.1', port: 0 });
      const restartedAddress = restarted.server.address() as AddressInfo;
      const restartedBaseUrl = `http://127.0.0.1:${String(restartedAddress.port)}`;

      const alphaAfterRestartFrames: StudentFrame[] = [];
      const alphaAfterRestartSocket = await openStudentSocket(restartedBaseUrl, students.alpha.cookie, alphaAfterRestartFrames);
      await waitFor(() => alphaAfterRestartFrames.some((f) => f.event === 'quiz.session' && (f.payload as { state?: string }).state === 'closed'));
      const alphaTerminalAfterRestart = alphaAfterRestartFrames.find((f) => f.event === 'quiz.session')!.payload as {
        participationState: string;
        finalScore: number;
        finalRank: number | null;
        answeredCount: number;
      };
      expect(alphaTerminalAfterRestart).toEqual(alphaTerminal);
      alphaAfterRestartSocket.close();

      const answerCountRows = await restarted.sql<{ count: string }[]>`SELECT count(*)::int AS count FROM answers WHERE quiz_session_id = ${quizSessionId}`;
      const participantCountRows = await restarted.sql<{ count: string }[]>`SELECT count(*)::int AS count FROM participants WHERE quiz_session_id = ${quizSessionId}`;
      expect(Number(answerCountRows[0]!.count)).toBe(3);
      expect(Number(participantCountRows[0]!.count)).toBe(3);

      await restarted.close();
      app = restarted; // afterAll only closes `app`; the original was already closed above.

      // ── Recursive privacy scan across every student frame captured in this run ──
      const allStudentFrames: Array<{ owner: string; frame: StudentFrame }> = [];
      for (const key of ['alpha', 'bravo'] as const) {
        for (const frame of students[key].frames) allStudentFrames.push({ owner: students[key].studentIdNumber, frame });
      }
      for (const frame of charlieReconnectFrames) allStudentFrames.push({ owner: students.charlie.studentIdNumber, frame });

      const allFullNames = ['Alpha Ownership', 'Bravo Ownership', 'Charlie Ownership'];
      const allStudentIds = ['IT0000001', 'IT0000002', 'IT0000003'];
      for (const { owner, frame } of allStudentFrames) {
        const json = JSON.stringify(frame);
        if (frame.event === 'quiz.question') {
          expect(json).not.toMatch(/correctOptionId/);
        }
        const ownerName = allFullNames[allStudentIds.indexOf(owner)]!;
        for (const otherName of allFullNames) {
          if (otherName === ownerName) continue;
          expect(json).not.toContain(otherName);
        }
        for (const otherId of allStudentIds) {
          if (otherId === owner) continue;
          expect(json).not.toContain(otherId);
        }
      }

      // No projector/panel payload path exists in D's student source at all (D owns only the
      // student wire envelope in `student/serializers.ts`/`student/stream.ts`, never the panel channel).
      const studentSrcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/student');
      for (const file of readdirSync(studentSrcDir)) {
        const contents = readFileSync(path.join(studentSrcDir, file), 'utf8');
        expect(contents).not.toMatch(/quiz\.publication|quiz\.responses/);
      }
    },
    150_000,
  );
});
