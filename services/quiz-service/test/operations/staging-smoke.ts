#!/usr/bin/env tsx
/**
 * D-10 campus staging smoke. Drives a deployed quiz service over its real
 * external HTTPS/WSS endpoint — never loopback — using the caller's
 * `--origin`, `--join-code`, and `--device-id`, plus the device bearer read
 * from stdin (never a command-line argument, never printed). This is an
 * external-network check against a live campus host; it cannot run inside
 * this repository's own test suite and has no PostgreSQL/Testcontainers
 * fallback.
 */
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { ulid } from 'ulidx';
import WebSocket from 'ws';
import {
  zQuizAppProblem,
  zResolveJoinCodeResponse,
  zStudentEventEnvelope,
  zSubmitAnswerResponse,
  type StudentEventEnvelope,
} from '@eduscope/shared';

interface CliArgs {
  origin: string;
  joinCode: string;
  deviceId: string;
}

function parseArgs(argv: string[]): CliArgs {
  const valueAfter = (name: string): string | undefined => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const origin = valueAfter('--origin');
  const joinCode = valueAfter('--join-code');
  const deviceId = valueAfter('--device-id');
  if (!origin || !joinCode || !deviceId) throw new Error('require --origin, --join-code, and --device-id');
  if (!origin.startsWith('https://')) throw new Error('--origin must be an https:// URL');
  return { origin: origin.replace(/\/$/, ''), joinCode, deviceId };
}

function connectWebSocket(url: string, headers: Record<string, string>): Promise<WebSocket> {
  return new Promise((resolvePromise, rejectPromise) => {
    const ws = new WebSocket(url, { headers });
    ws.once('open', () => resolvePromise(ws));
    ws.once('error', rejectPromise);
  });
}

async function waitUntil(predicate: () => boolean, description: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${description}`);
    await delay(50);
  }
}

async function main(): Promise<void> {
  const { origin, joinCode, deviceId } = parseArgs(process.argv.slice(2));
  const bearer = readFileSync(0, 'utf8').trim();
  if (bearer.length < 32) throw new Error('device bearer must contain at least 32 characters');
  const wsOrigin = origin.replace(/^https/, 'wss');
  const results: string[] = [];

  // 1. External /j/CODE returns the Next page over HTTPS.
  const joinPage = await fetch(`${origin}/j/${joinCode}`);
  if (joinPage.status !== 200) throw new Error(`GET /j/${joinCode} over HTTPS returned ${joinPage.status}`);
  results.push('PASS: /j/CODE reachable over HTTPS');

  // 2. Direct loopback port is unreachable externally.
  const directHost = new URL(origin).hostname;
  try {
    await fetch(`http://${directHost}:7300/healthz`, { signal: AbortSignal.timeout(3_000) });
    throw new Error('direct http://host:7300 unexpectedly reachable — Node must stay loopback-only');
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('direct http')) throw error;
    results.push('PASS: direct :7300 unreachable externally');
  }

  // 3. Wrong bearer is 401.
  const wrongBearerResponse = await fetch(`${origin}/device/v1/quiz-sessions`, {
    method: 'POST',
    headers: { authorization: 'Bearer wrong-bearer-wrong-bearer-wrong-bearer', 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId, lectureSessionId: ulid(), hallDisplayName: 'Staging Smoke' }),
  });
  if (wrongBearerResponse.status !== 401) throw new Error(`wrong bearer returned ${wrongBearerResponse.status}, expected 401`);
  zQuizAppProblem.parse(await wrongBearerResponse.json()).status;
  results.push('PASS: wrong bearer rejected with 401');

  // 4. Device create/publish/close authenticate with x-eduscope-contract:1.0.
  const lectureSessionId = ulid();
  const createResponse = await fetch(`${origin}/device/v1/quiz-sessions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${bearer}`,
      'content-type': 'application/json',
      'x-eduscope-contract': '1.0',
    },
    body: JSON.stringify({ deviceId, lectureSessionId, hallDisplayName: 'Staging Smoke' }),
  });
  if (createResponse.status !== 201) throw new Error(`device session create returned ${createResponse.status}`);
  const session = (await createResponse.json()) as { id: string; joinCode: string };
  results.push('PASS: device session create authenticated');

  const publicationId = ulid();
  const optionIds = [ulid(), ulid(), ulid(), ulid()];
  const publishResponse = await fetch(`${origin}/device/v1/publications`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${bearer}`,
      'content-type': 'application/json',
      'x-eduscope-contract': '1.0',
    },
    body: JSON.stringify({
      publicationId,
      quizSessionId: session.id,
      questionId: ulid(),
      prompt: 'Staging smoke question',
      options: [
        { id: optionIds[0], label: 'A', text: 'Correct' },
        { id: optionIds[1], label: 'B', text: 'Wrong' },
        { id: optionIds[2], label: 'C', text: 'Wrong' },
        { id: optionIds[3], label: 'D', text: 'Wrong' },
      ],
      correctOptionId: optionIds[0],
      publishedAt: new Date().toISOString(),
    }),
  });
  if (publishResponse.status !== 201) throw new Error(`device publish returned ${publishResponse.status}`);
  results.push('PASS: device publish authenticated');

  // 5. Student resolve/register/cookie/WS/answer/result over HTTPS/WSS.
  const resolveResponse = await fetch(`${origin}/api/student/v1/join-codes/${session.joinCode}`);
  if (resolveResponse.status !== 200) throw new Error(`resolve returned ${resolveResponse.status}`);
  zResolveJoinCodeResponse.parse(await resolveResponse.json());
  results.push('PASS: student resolve over HTTPS');

  const studentIdNumber = `IT${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
  const registerResponse = await fetch(`${origin}/api/student/v1/quiz-sessions/${session.id}/participants`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fullName: 'Staging Smoke Student', studentIdNumber }),
  });
  if (registerResponse.status !== 200) throw new Error(`registration returned ${registerResponse.status}`);
  const setCookie = registerResponse.headers.get('set-cookie');
  if (!setCookie) throw new Error('registration did not set the participant cookie');
  const cookie = setCookie.split(';')[0]!;
  results.push('PASS: student registration + cookie over HTTPS');

  const frames: StudentEventEnvelope[] = [];
  const studentSocket = await connectWebSocket(`${wsOrigin}/api/student/v1/stream`, { cookie });
  studentSocket.on('message', (data) => frames.push(zStudentEventEnvelope.parse(JSON.parse(data.toString()))));
  await waitUntil(() => frames.some((f) => f.event === 'quiz.question' && f.payload.state === 'open'), 'student open-question snapshot/delta');
  results.push('PASS: student WSS snapshot delivered');

  const answerResponse = await fetch(`${origin}/api/student/v1/publications/${publicationId}/answers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ selectedOptionId: optionIds[0] }),
  });
  if (answerResponse.status !== 200) throw new Error(`answer submit returned ${answerResponse.status}`);
  zSubmitAnswerResponse.parse(await answerResponse.json());
  results.push('PASS: student answer accepted over HTTPS');

  const closeResponse = await fetch(`${origin}/device/v1/publications/${publicationId}/close`, {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    body: JSON.stringify({ publicationId, closedAt: new Date().toISOString(), closeReason: 'lecturer-closed' }),
  });
  if (closeResponse.status !== 204) throw new Error(`device close returned ${closeResponse.status}`);
  await waitUntil(() => frames.some((f) => f.event === 'quiz.result'), 'student private result after close');
  results.push('PASS: student private result delivered over WSS after close');

  studentSocket.close();

  for (const line of results) process.stdout.write(`${line}\n`);
  process.stdout.write(
    'NOTE: service-restart reconnection and backup/restore verification are separate, ' +
      'explicit steps in deploy/campus/README.md — this script covers the direct HTTPS/WSS request/response surface only.\n',
  );
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
