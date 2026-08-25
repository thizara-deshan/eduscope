#!/usr/bin/env tsx
/**
 * D-09: the exact 200-client join/WS/answer/result burst. Runs against a
 * local `buildApp` + Testcontainers PostgreSQL by default, or against
 * `QUIZ_LOAD_BASE_URL`/`QUIZ_LOAD_DATABASE_URL` (staging) when set. The
 * master supplies no numeric quiz latency SLA — timings are measured and
 * recorded, never gated on; only functional/capacity errors fail the run.
 */
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import postgres, { type Sql } from 'postgres';
import { ulid } from 'ulidx';
import WebSocket from 'ws';
import {
  scoreQuizParticipants,
  zQuizSessionCreateResponse,
  zRegisterParticipantResponse,
  zResolveJoinCodeResponse,
  zStudentEventEnvelope,
  zSubmitAnswerResponse,
  type StudentEventEnvelope,
} from '@eduscope/shared';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { hashDeviceCredential } from '../../src/device/credentials.js';
import { SystemClock } from '../../src/lib/clock.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { startTestPostgres } from '../helpers/postgres.js';
import { TimingCollector, writeEvidence } from './report.js';

const CLIENT_COUNT = 200;
const RECONNECT_COUNT = 50;
const RETRY_COUNT = 20;
const WAIT_TIMEOUT_MS = 20_000;
const WAIT_POLL_MS = 25;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

interface CliArgs {
  evidence: string;
}

function parseArgs(argv: string[]): CliArgs {
  const index = argv.indexOf('--evidence');
  const value = index >= 0 ? argv[index + 1] : undefined;
  const path = value ?? 'services/quiz-service/test/load/evidence/d09-local.json';
  return { evidence: path.startsWith('/') ? path : resolve(repoRoot, path) };
}

interface LoadTarget {
  baseUrl: string;
  wsBaseUrl: string;
  sql: Sql | undefined;
  close(): Promise<void>;
}

async function startLocalTarget(): Promise<{ target: LoadTarget; deviceId: string; bearer: string }> {
  const pg = await startTestPostgres();
  const config = loadConfig({ NODE_ENV: 'test', QUIZ_SERVICE_DATABASE_URL: pg.connectionString });
  const app = await buildApp({ config, clock: new SystemClock(), ids: new UlidGenerator() });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const wsBaseUrl = `ws://127.0.0.1:${address.port}`;

  const deviceId = ulid();
  const bearer = `load-device-bearer-${randomUUID()}`;
  await app.sql`
    INSERT INTO devices (device_id, credential_hash, hall_display_name, enabled, created_at)
    VALUES (${deviceId}, ${await hashDeviceCredential(bearer)}, 'Load Test Hall', true, now())
  `;

  const target: LoadTarget = {
    baseUrl,
    wsBaseUrl,
    sql: app.sql,
    async close(): Promise<void> {
      await app.close();
      await pg.stop();
    },
  };
  return { target, deviceId, bearer };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required env var ${name} for staging load target`);
  return value;
}

function startStagingTarget(): { target: LoadTarget; deviceId: string; bearer: string } {
  const baseUrl = requireEnv('QUIZ_LOAD_BASE_URL').replace(/\/$/, '');
  const wsBaseUrl = baseUrl.replace(/^http/, 'ws');
  const deviceId = requireEnv('QUIZ_LOAD_DEVICE_ID');
  const bearer = requireEnv('QUIZ_LOAD_DEVICE_BEARER');
  const databaseUrl = process.env.QUIZ_LOAD_DATABASE_URL;
  const sql = databaseUrl ? postgres(databaseUrl, { max: 5 }) : undefined;

  return {
    target: {
      baseUrl,
      wsBaseUrl,
      sql,
      async close(): Promise<void> {
        await sql?.end({ timeout: 5 });
      },
    },
    deviceId,
    bearer,
  };
}

interface StudentClient {
  index: number;
  studentIdNumber: string;
  cookie: string;
  ws: WebSocket;
  frames: StudentEventEnvelope[];
}

function attachFrameCollector(ws: WebSocket, frames: StudentEventEnvelope[]): void {
  ws.on('message', (data) => {
    const envelope = zStudentEventEnvelope.parse(JSON.parse(data.toString()));
    frames.push(envelope);
  });
}

function connectWebSocket(url: string, headers: Record<string, string>): Promise<WebSocket> {
  return new Promise((resolvePromise, rejectPromise) => {
    const ws = new WebSocket(url, { headers });
    ws.once('open', () => resolvePromise(ws));
    ws.once('error', rejectPromise);
  });
}

async function waitUntil(predicate: () => boolean, description: string, timeoutMs = WAIT_TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${description}`);
    await delay(WAIT_POLL_MS);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const isStaging = Boolean(process.env.QUIZ_LOAD_BASE_URL);
  const { target, deviceId, bearer } = isStaging ? startStagingTarget() : await startLocalTarget();
  const timings = new TimingCollector();
  const errors: string[] = [];

  try {
    // Step 1: provision one device (already done), create one quiz session, resolve its join code.
    const lectureSessionId = ulid();
    const createResponse = await fetch(`${target.baseUrl}/device/v1/quiz-sessions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId, lectureSessionId, hallDisplayName: 'Load Test Hall' }),
    });
    if (createResponse.status !== 201) throw new Error(`quiz session create failed: ${createResponse.status}`);
    const session = zQuizSessionCreateResponse.parse(await createResponse.json());
    const quizSessionId = session.id;

    const resolveStart = Date.now();
    const resolveResponse = await fetch(`${target.baseUrl}/api/student/v1/join-codes/${session.joinCode}`);
    timings.record('resolve', Date.now() - resolveStart);
    if (resolveResponse.status !== 200) throw new Error(`resolve failed: ${resolveResponse.status}`);
    zResolveJoinCodeResponse.parse(await resolveResponse.json());

    // Step 2: register 200 unique valid-format ids, each its own cookie jar
    // and a distinct RFC 2544 test address in X-Forwarded-For.
    const registrations: { studentIdNumber: string; cookie: string }[] = new Array(CLIENT_COUNT);
    await Promise.all(
      Array.from({ length: CLIENT_COUNT }, (_, i) => i).map(async (i) => {
        const studentIdNumber = `IT${(i + 1).toString().padStart(7, '0')}`;
        const start = Date.now();
        const response = await fetch(`${target.baseUrl}/api/student/v1/quiz-sessions/${quizSessionId}/participants`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': `198.18.0.${i + 1}` },
          body: JSON.stringify({ fullName: `Load Student ${i + 1}`, studentIdNumber }),
        });
        timings.record('registration', Date.now() - start);
        if (response.status !== 200) throw new Error(`registration ${i} failed: ${response.status}`);
        zRegisterParticipantResponse.parse(await response.json());
        const setCookie = response.headers.get('set-cookie');
        if (!setCookie) throw new Error(`registration ${i} did not set a cookie`);
        registrations[i] = { studentIdNumber, cookie: setCookie.split(';')[0]! };
      }),
    );

    // Step 3: open 200 cookie-authenticated student WS connections; wait for
    // the complete ordered atomic snapshot (session, participant, question:none).
    const clients: StudentClient[] = await Promise.all(
      registrations.map(async ({ studentIdNumber, cookie }, index) => {
        const start = Date.now();
        const ws = await connectWebSocket(`${target.wsBaseUrl}/api/student/v1/stream`, { cookie });
        const frames: StudentEventEnvelope[] = [];
        attachFrameCollector(ws, frames);
        await waitUntil(() => frames.length >= 3, `client ${index} cold snapshot`);
        timings.record('snapshot', Date.now() - start);
        return { index, studentIdNumber, cookie, ws, frames };
      }),
    );

    // Step 4: open the device stream, send hello, publish a four-option
    // question, and require all 200 sockets to receive the open question.
    const deviceSocket = await connectWebSocket(`${target.wsBaseUrl}/api/device/v1/stream`, {
      authorization: `Bearer ${bearer}`,
    });
    const deviceFrames: Record<string, unknown>[] = [];
    deviceSocket.on('message', (data) => {
      deviceFrames.push(JSON.parse(data.toString()) as Record<string, unknown>);
    });
    deviceSocket.send(JSON.stringify({ type: 'sync.hello', deviceId, quizSessionId, answerWatermark: 0 }));
    await waitUntil(
      () => deviceFrames.some((f) => f.type === 'sync.participants'),
      'device hello participant counts',
    );

    const publicationId = ulid();
    const optionIds = [ulid(), ulid(), ulid(), ulid()];
    const correctOptionId = optionIds[0]!;
    const publishStart = Date.now();
    const publishResponse = await fetch(`${target.baseUrl}/device/v1/publications`, {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        publicationId,
        quizSessionId,
        questionId: ulid(),
        prompt: 'Load test question',
        options: [
          { id: optionIds[0], label: 'A', text: 'Correct option' },
          { id: optionIds[1], label: 'B', text: 'Wrong option B' },
          { id: optionIds[2], label: 'C', text: 'Wrong option C' },
          { id: optionIds[3], label: 'D', text: 'Wrong option D' },
        ],
        correctOptionId,
        publishedAt: new Date().toISOString(),
      }),
    });
    if (publishResponse.status !== 201) throw new Error(`publish failed: ${publishResponse.status}`);

    for (const client of clients) {
      await waitUntil(
        () => client.frames.some((f) => f.event === 'quiz.question' && f.payload.state === 'open'),
        `client ${client.index} open question delta`,
      );
    }
    timings.record('publishFanOut', Date.now() - publishStart);

    // Step 5: release a burst — every client submits once; 20 chosen
    // clients immediately retry with the opposite option.
    const wrongAnswererIndices = new Set(clients.slice(150).map((c) => c.index));
    const retryIndices = new Set(clients.slice(0, RETRY_COUNT).map((c) => c.index));

    await Promise.all(
      clients.map(async (client) => {
        const chosenOptionId = wrongAnswererIndices.has(client.index) ? optionIds[1]! : correctOptionId;
        const start = Date.now();
        const response = await fetch(`${target.baseUrl}/api/student/v1/publications/${publicationId}/answers`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: client.cookie },
          body: JSON.stringify({ selectedOptionId: chosenOptionId }),
        });
        timings.record('answer', Date.now() - start);
        if (response.status !== 200) throw new Error(`answer ${client.index} failed: ${response.status}`);
        const body = zSubmitAnswerResponse.parse(await response.json());
        if (body.outcome !== 'accepted' || body.selectedOptionId !== chosenOptionId) {
          errors.push(`client ${client.index} first submit was not a fresh accept`);
        }

        if (retryIndices.has(client.index)) {
          const oppositeOptionId = chosenOptionId === correctOptionId ? optionIds[1]! : correctOptionId;
          const retryResponse = await fetch(`${target.baseUrl}/api/student/v1/publications/${publicationId}/answers`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', cookie: client.cookie },
            body: JSON.stringify({ selectedOptionId: oppositeOptionId }),
          });
          if (retryResponse.status !== 200) throw new Error(`retry ${client.index} failed: ${retryResponse.status}`);
          const retryBody = zSubmitAnswerResponse.parse(await retryResponse.json());
          if (retryBody.outcome !== 'already-accepted' || retryBody.selectedOptionId !== chosenOptionId) {
            errors.push(`client ${client.index} retry did not return the original stored option`);
          }
        }
      }),
    );

    // Step 6: one D answer row per student, 200 distinct seq values, device
    // answer frames of at most 200 items, no duplicate projection key.
    await waitUntil(() => {
      const delivered = deviceFrames
        .filter((f) => f.type === 'sync.answers')
        .flatMap((f) => f.answers as { publicationId: string; studentIdNumber: string; seq: number }[]);
      return delivered.length >= CLIENT_COUNT;
    }, 'device replay of all 200 answers');

    const answerFrames = deviceFrames.filter((f) => f.type === 'sync.answers');
    for (const frame of answerFrames) {
      const batch = frame.answers as unknown[];
      if (batch.length > 200) errors.push(`device answer frame exceeded 200 items (${batch.length})`);
    }
    const deliveredAnswers = answerFrames.flatMap(
      (f) => f.answers as { publicationId: string; studentIdNumber: string; seq: number }[],
    );
    const projectionKeys = new Set<string>();
    let duplicateProjections = 0;
    for (const answer of deliveredAnswers) {
      const key = `${answer.publicationId}:${answer.studentIdNumber}`;
      if (projectionKeys.has(key)) duplicateProjections += 1;
      projectionKeys.add(key);
    }
    const distinctSeq = new Set(deliveredAnswers.map((a) => a.seq)).size;

    let duplicateRows = duplicateProjections;
    if (target.sql) {
      const rowCountRows = await target.sql<
        { count: number }[]
      >`SELECT count(*)::int AS count FROM answers WHERE quiz_session_id=${quizSessionId}`;
      const rowCount = rowCountRows[0]!.count;
      const distinctPairRows = await target.sql<{ count: number }[]>`
        SELECT count(DISTINCT (publication_id, student_id))::int AS count
        FROM answers WHERE quiz_session_id=${quizSessionId}
      `;
      const distinctPairs = distinctPairRows[0]!.count;
      if (rowCount !== CLIENT_COUNT) errors.push(`expected ${CLIENT_COUNT} answer rows, found ${rowCount}`);
      if (distinctPairs !== rowCount) duplicateRows = rowCount - distinctPairs;
    }
    if (distinctSeq !== CLIENT_COUNT) errors.push(`expected ${CLIENT_COUNT} distinct seq values, found ${distinctSeq}`);

    // Step 7: close the publication; every socket gets closed-question then
    // exactly one private result. Compare score/rank to the shared helper.
    const closeStart = Date.now();
    const closeResponse = await fetch(`${target.baseUrl}/device/v1/publications/${publicationId}/close`, {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
      body: JSON.stringify({ publicationId, closedAt: new Date().toISOString(), closeReason: 'lecturer-closed' }),
    });
    if (closeResponse.status !== 204) throw new Error(`publication close failed: ${closeResponse.status}`);

    for (const client of clients) {
      await waitUntil(
        () => client.frames.some((f) => f.event === 'quiz.result'),
        `client ${client.index} private result`,
      );
    }
    timings.record('closeToResult', Date.now() - closeStart);

    const expectedInputs = clients.map((client) => ({
      studentIdNumber: client.studentIdNumber,
      displayName: client.studentIdNumber,
      answered: 1,
      correct: wrongAnswererIndices.has(client.index) ? 0 : 1,
      responseMsTotal: 0,
    }));
    const expectedScored = new Map(scoreQuizParticipants(expectedInputs).map((row) => [row.studentIdNumber, row]));

    const allStudentIds = new Set(clients.map((c) => c.studentIdNumber));
    let privacyLeaks = 0;
    for (const client of clients) {
      const resultFrame = client.frames.find((f) => f.event === 'quiz.result');
      if (!resultFrame || resultFrame.event !== 'quiz.result') {
        errors.push(`client ${client.index} never received a result frame`);
        continue;
      }
      const expected = expectedScored.get(client.studentIdNumber)!;
      const payload = resultFrame.payload;
      if (payload.pointsAwarded !== expected.points || payload.ownRank !== expected.rank) {
        errors.push(`client ${client.index} score/rank mismatch with shared helper`);
      }
      const serialized = JSON.stringify(client.frames);
      for (const otherId of allStudentIds) {
        if (otherId === client.studentIdNumber) continue;
        if (serialized.includes(otherId)) privacyLeaks += 1;
      }
    }

    // Step 8: close 50 sockets, reconnect them, require replacement
    // snapshots with the current closed question/result and no stale prior question.
    const toReconnect = clients.slice(50, 50 + RECONNECT_COUNT);
    let staleReconnects = 0;
    await Promise.all(
      toReconnect.map(async (client) => {
        client.ws.close();
        const start = Date.now();
        const ws = await connectWebSocket(`${target.wsBaseUrl}/api/student/v1/stream`, { cookie: client.cookie });
        const frames: StudentEventEnvelope[] = [];
        attachFrameCollector(ws, frames);
        await waitUntil(() => frames.length >= 4, `client ${client.index} reconnect snapshot`);
        timings.record('reconnectSnapshot', Date.now() - start);
        client.ws = ws;
        client.frames = frames;
        const eventOrder = frames.slice(0, 4).map((f) => f.event);
        if (eventOrder[0] !== 'quiz.session' || eventOrder[1] !== 'quiz.participant') {
          staleReconnects += 1;
        }
        if (eventOrder[2] !== 'quiz.question' || frames[2]!.event !== 'quiz.question' || frames[2]!.payload.state !== 'closed') {
          staleReconnects += 1;
        }
        if (eventOrder[3] !== 'quiz.result') {
          staleReconnects += 1;
        }
      }),
    );

    // Step 9: close the quiz session; require 200 terminal own summaries
    // with answered count 1.
    const sessionCloseResponse = await fetch(`${target.baseUrl}/device/v1/quiz-sessions/${quizSessionId}/close`, {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer}` },
    });
    if (sessionCloseResponse.status !== 204) {
      throw new Error(`session close failed: ${sessionCloseResponse.status}`);
    }

    let terminalCount = 0;
    for (const client of clients) {
      await waitUntil(
        () =>
          client.frames.some(
            (f) => f.event === 'quiz.session' && f.payload.state === 'closed' && f.payload.participationState === 'participated',
          ),
        `client ${client.index} terminal summary`,
      );
      const terminal = client.frames.find(
        (f): f is Extract<StudentEventEnvelope, { event: 'quiz.session' }> => f.event === 'quiz.session' && f.payload.state === 'closed',
      );
      if (terminal && terminal.payload.state === 'closed' && terminal.payload.participationState === 'participated') {
        if (terminal.payload.answeredCount === 1) terminalCount += 1;
        else errors.push(`client ${client.index} answeredCount was ${terminal.payload.answeredCount}, expected 1`);
      }
    }

    for (const client of clients) client.ws.close();
    deviceSocket.close();

    const summary = {
      clients: CLIENT_COUNT,
      answers: deliveredAnswers.length >= CLIENT_COUNT ? CLIENT_COUNT : deliveredAnswers.length,
      duplicateRows,
      privacyLeaks,
      staleReconnects,
      terminalSummaries: terminalCount,
      errors,
    };

    console.log(
      `clients=${summary.clients} answers=${summary.answers} duplicateRows=${summary.duplicateRows} privacyLeaks=${summary.privacyLeaks}`,
    );
    console.log('timings (ms):', JSON.stringify(timings.summary(), null, 2));

    await writeEvidence(args.evidence, {
      generatedAt: new Date().toISOString(),
      environment: isStaging ? target.baseUrl : 'local-testcontainers',
      summary,
      timings: timings.summary(),
    });

    if (errors.length > 0 || duplicateRows > 0 || privacyLeaks > 0) {
      console.error('D-09 load workload FAILED', errors);
      process.exitCode = 1;
    }
  } finally {
    await target.close();
  }
}

await main();
