import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { hashDeviceCredential } from '../../src/device/credentials.js';
import { startTestPostgres, type TestPostgres } from '../helpers/postgres.js';
import { startTlsProxy, type TlsProxy } from '../helpers/tls-proxy.js';

const QUIZ_SESSION_ID = '01K4A8E0600000000000000002';
const JOIN_CODE = 'E06TEST';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`e2e quiz peer: missing ${name}`);
  return value;
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw.length === 0 ? {} : JSON.parse(raw) as Record<string, unknown>;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function listenControl(
  handler: (action: string, input: unknown) => Promise<unknown>,
): Promise<{ server: Server; url: string }> {
  const server = createServer((request, response) => {
    void (async () => {
      if (request.method !== 'POST' || request.url !== '/control') {
        sendJson(response, 404, { error: 'not-found' });
        return;
      }
      try {
        const body = await readJson(request);
        sendJson(response, 200, await handler(String(body.action ?? ''), body.input));
      } catch (error) {
        sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
      }
    })();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${String(address.port)}/control` };
}

async function reservePort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as AddressInfo).port;
  server.close();
  await once(server, 'close');
  return port;
}

async function main(): Promise<void> {
  const deviceId = required('E06_QUIZ_DEVICE_ID');
  const deviceBearer = required('E06_QUIZ_DEVICE_BEARER');
  const pg: TestPostgres = await startTestPostgres();
  const port = await reservePort();
  const baseUrl = `http://127.0.0.1:${String(port)}`;
  const browserOrigin = 'http://127.0.0.1:3000';
  const config = loadConfig({
    NODE_ENV: 'test',
    QUIZ_SERVICE_HOST: '127.0.0.1',
    QUIZ_SERVICE_PORT: String(port),
    QUIZ_SERVICE_DATABASE_URL: pg.connectionString,
    QUIZ_SERVICE_PUBLIC_ORIGIN: browserOrigin,
    QUIZ_SERVICE_COOKIE_SECRET: required('E06_QUIZ_COOKIE_SECRET'),
    QUIZ_SERVICE_LOG_LEVEL: 'warn',
  });

  let app: FastifyInstance | null = null;
  let deviceUpgradeAllowed = true;
  const start = async (): Promise<void> => {
    if (app) return;
    const next = await buildApp({ config, deviceUpgradeAllowed: () => deviceUpgradeAllowed });
    await next.sql`
      INSERT INTO devices (device_id, credential_hash, hall_display_name, enabled, created_at)
      VALUES (${deviceId}, ${await hashDeviceCredential(deviceBearer)}, 'E-06 Hall', true, now())
      ON CONFLICT (device_id) DO NOTHING
    `;
    await next.sql`
      INSERT INTO quiz_sessions (
        id, lecture_session_id, device_id, hall_display_name, join_code, join_url,
        state, opened_at, closed_at, next_answer_seq
      ) VALUES (
        ${QUIZ_SESSION_ID}, '01K4A8E0600000000000000003', ${deviceId}, 'E-06 Hall',
        ${JOIN_CODE}, ${`${browserOrigin}/j/${JOIN_CODE}`}, 'open', now(), null, 0
      ) ON CONFLICT (id) DO NOTHING
    `;
    await next.listen({ host: '127.0.0.1', port });
    app = next;
  };
  const stop = async (): Promise<void> => {
    const current = app;
    app = null;
    await current?.close();
  };
  await start();
  const tls: TlsProxy = await startTlsProxy(port);

  const captureStudentSnapshot = async (): Promise<{ frames: unknown[] }> => {
    const registration = await fetch(`${baseUrl}/api/student/v1/quiz-sessions/${QUIZ_SESSION_ID}/participants`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fullName: 'E-06 Student', studentIdNumber: 'IT12345678' }),
    });
    if (!registration.ok) throw new Error(`registration failed: ${String(registration.status)}`);
    const setCookie = registration.headers.getSetCookie()
      .find((value) => value.startsWith('eduscope_participant='));
    if (!setCookie) throw new Error('registration returned no participant cookie');
    const cookie = setCookie.split(';', 1)[0]!;
    const frames: unknown[] = [];
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(`${baseUrl.replace(/^http/, 'ws')}/api/student/v1/stream`, {
        headers: { cookie },
      });
      const timeout = setTimeout(() => {
        socket.terminate();
        reject(new Error('student snapshot timed out'));
      }, 10_000);
      socket.on('message', (data) => {
        frames.push(JSON.parse(data.toString()) as unknown);
        if (frames.length >= 3) {
          clearTimeout(timeout);
          socket.close();
          resolve();
        }
      });
      socket.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
    return { frames };
  };

  const control = await listenControl(async (action, input) => {
    switch (action) {
      case 'quiz.capabilities':
        return { actions: ['quiz.start', 'quiz.stop', 'quiz.restart', 'quiz.device-sync', 'quiz.capture-student-snapshot', 'quiz.publication-audit'] };
      case 'quiz.start':
        await start();
        return { running: true };
      case 'quiz.stop':
        await stop();
        return { running: false };
      case 'quiz.restart':
        await stop();
        await start();
        return { running: true };
      case 'quiz.device-sync':
        deviceUpgradeAllowed = (input as { available?: unknown } | undefined)?.available === true;
        return { available: deviceUpgradeAllowed };
      case 'quiz.capture-student-snapshot':
        return captureStudentSnapshot();
      case 'quiz.publication-audit': {
        // Counts the durable publication rows D has actually stored (optionally
        // scoped to a state), so a screen witness can prove publish-before-project
        // and that a failed publish left no row behind. Reads D's own store — the
        // authoritative side of the B→D publish contract.
        const state = (input as { state?: unknown } | undefined)?.state;
        const running = app;
        if (!running) throw new Error('quiz.publication-audit requires the quiz service running');
        const rows = typeof state === 'string'
          ? await running.sql`SELECT count(*)::int AS count FROM publications WHERE state = ${state}`
          : await running.sql`SELECT count(*)::int AS count FROM publications`;
        return { count: Number((rows[0] as { count: number } | undefined)?.count ?? 0) };
      }
      default:
        throw new Error(`unknown quiz control action: ${action}`);
    }
  });

  process.stdout.write(`${JSON.stringify({
    type: 'ready',
    service: 'quiz',
    baseUrl,
    tlsBaseUrl: `https://127.0.0.1:${String(tls.port)}`,
    controlUrl: control.url,
    fixtureIds: { deviceId, quizSessionId: QUIZ_SESSION_ID, joinCode: JOIN_CODE },
  })}\n`);

  let closing: Promise<void> | null = null;
  const close = (): Promise<void> => closing ??= (async () => {
    await new Promise<void>((resolve) => {
      control.server.close(() => resolve());
      control.server.closeAllConnections();
    });
    await tls.close();
    await stop();
    await pg.stop();
  })();
  process.once('SIGTERM', () => void close().then(() => process.exit(0)));
  process.once('SIGINT', () => void close().then(() => process.exit(0)));
}

main().catch((error: unknown) => {
  process.stdout.write(`${JSON.stringify({ type: 'error', message: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
});
