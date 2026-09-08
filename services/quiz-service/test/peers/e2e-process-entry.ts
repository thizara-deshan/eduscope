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
  // The quiz app's own real e2e run overrides this to its HTTPS origin
  // (apps/quiz/playwright.config.ts) so this service's CORS allowlist
  // (app.ts's `origin: (origin) => origin === config.publicOrigin`) matches
  // the browser's actual origin; other real-stack consumers (panel specs
  // that opt into the full B+D stack) never call this service from a real
  // browser, so the default is harmless for them.
  const browserOrigin = process.env.E06_QUIZ_BROWSER_ORIGIN ?? 'http://127.0.0.1:3000';
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
        return { actions: ['quiz.start', 'quiz.stop', 'quiz.restart', 'quiz.device-sync', 'quiz.capture-student-snapshot', 'quiz.publication-audit', 'quiz.submit-answers', 'quiz.foreign-room', 'quiz.close-session', 'quiz.participant-audit', 'quiz.publish-question', 'quiz.close-publication', 'quiz.answer-audit'] };
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
      case 'quiz.submit-answers': {
        // Registers `count` phone participants and submits one answer each to
        // the current open publication (the first `correctCount` pick the
        // correct option, the rest a wrong one), exactly as students' phones
        // would. Returns what was stored so a witness can compare B's replayed
        // projection against D's authoritative answers. Reads options straight
        // from D's own publication row.
        const running = app;
        if (!running) throw new Error('quiz.submit-answers requires the quiz service running');
        const count = Number((input as { count?: unknown } | undefined)?.count ?? 3);
        const correctCount = Number((input as { correctCount?: unknown } | undefined)?.correctCount ?? count);
        const rows = await running.sql`
          SELECT id, quiz_session_id, options, correct_option_id
          FROM publications WHERE state = 'open' ORDER BY published_at DESC LIMIT 1`;
        const pub = rows[0] as {
          id: string; quiz_session_id: string;
          options: Array<{ id: string; label: string; text: string }>; correct_option_id: string;
        } | undefined;
        if (!pub) throw new Error('quiz.submit-answers: no open publication');
        const wrongOption = pub.options.find((option) => option.id !== pub.correct_option_id) ?? pub.options[0]!;
        const submitted: Array<{ studentIdNumber: string; selectedOptionId: string; isCorrect: boolean }> = [];
        for (let i = 0; i < count; i += 1) {
          const studentIdNumber = `IT${String(20000000 + i)}`;
          const registration = await fetch(`${baseUrl}/api/student/v1/quiz-sessions/${pub.quiz_session_id}/participants`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ fullName: `Phone Student ${String(i + 1)}`, studentIdNumber }),
          });
          if (!registration.ok) throw new Error(`participant registration failed: ${String(registration.status)}`);
          const setCookie = registration.headers.getSetCookie().find((value) => value.startsWith('eduscope_participant='));
          if (!setCookie) throw new Error('registration returned no participant cookie');
          const cookie = setCookie.split(';', 1)[0]!;
          const isCorrect = i < correctCount;
          const selectedOptionId = isCorrect ? pub.correct_option_id : wrongOption.id;
          const answer = await fetch(`${baseUrl}/api/student/v1/publications/${pub.id}/answers`, {
            method: 'POST', headers: { 'content-type': 'application/json', cookie },
            body: JSON.stringify({ selectedOptionId }),
          });
          if (!answer.ok) throw new Error(`answer submission failed: ${String(answer.status)}`);
          submitted.push({ studentIdNumber, selectedOptionId, isCorrect });
        }
        return { publicationId: pub.id, submitted };
      }
      case 'quiz.foreign-room': {
        // Plants a *different* device's room in D — its own open session,
        // publication, student and answer with a distinctive identity — as bait,
        // and has that foreign device attempt to hijack OUR lecture's session.
        // A witness then proves D denies the cross-device attempt and that the
        // foreign identity never bleeds into our room's names (cross-session
        // isolation is structural: B only syncs its own session).
        const running = app;
        if (!running) throw new Error('quiz.foreign-room requires the quiz service running');
        const ourLectureSessionId = String((input as { ourLectureSessionId?: unknown } | undefined)?.ourLectureSessionId ?? '');
        const foreignDeviceId = '01K4A8E0600000000000000009';
        const foreignBearer = 'e06-foreign-device-bearer-000000000000';
        const foreignName = 'Zzz Foreign Intruder';
        const foreignStudentIdNumber = 'IT99990001';
        const options = JSON.stringify([{ id: 'fo1', label: 'A', text: 'a' }, { id: 'fo2', label: 'B', text: 'b' }]);
        await running.sql`INSERT INTO devices (device_id, credential_hash, hall_display_name, enabled, created_at)
          VALUES (${foreignDeviceId}, ${await hashDeviceCredential(foreignBearer)}, 'Foreign Hall', true, now()) ON CONFLICT (device_id) DO NOTHING`;
        await running.sql`INSERT INTO quiz_sessions (id, lecture_session_id, device_id, hall_display_name, join_code, join_url, state, opened_at, next_answer_seq)
          VALUES ('e06-foreign-session', 'e06-foreign-lecture', ${foreignDeviceId}, 'Foreign Hall', 'FGN00001', 'http://x/j/FGN00001', 'open', now(), 1) ON CONFLICT (id) DO NOTHING`;
        await running.sql`INSERT INTO publications (id, quiz_session_id, question_id, prompt, options, correct_option_id, state, published_at)
          VALUES ('e06-foreign-pub', 'e06-foreign-session', 'fq', 'Foreign question?', ${options}::jsonb, 'fo1', 'open', now()) ON CONFLICT (id) DO NOTHING`;
        await running.sql`INSERT INTO students (id, student_id_number, full_name, auth_method, created_at, last_seen_at)
          VALUES ('e06-foreign-student', ${foreignStudentIdNumber}, ${foreignName}, 'self-registered', now(), now()) ON CONFLICT (id) DO NOTHING`;
        await running.sql`INSERT INTO participants (id, quiz_session_id, student_id, joined_at, last_seen_at, connection_state)
          VALUES ('e06-foreign-part', 'e06-foreign-session', 'e06-foreign-student', now(), now(), 'online') ON CONFLICT (id) DO NOTHING`;
        await running.sql`INSERT INTO answers (id, quiz_session_id, publication_id, student_id, selected_option_id, is_correct, points_awarded, response_time_ms, submitted_at, seq)
          VALUES ('e06-foreign-answer', 'e06-foreign-session', 'e06-foreign-pub', 'e06-foreign-student', 'fo1', true, 10, 1000, now(), 1) ON CONFLICT (id) DO NOTHING`;
        // The foreign device tries to seize OUR lecture's open session.
        const attempt = await fetch(`${baseUrl}/device/v1/quiz-sessions`, {
          method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${foreignBearer}` },
          body: JSON.stringify({ lectureSessionId: ourLectureSessionId, deviceId: foreignDeviceId, hallDisplayName: 'Foreign Hall' }),
        });
        return { foreignName, foreignStudentIdNumber, crossDeviceStatus: attempt.status };
      }
      case 'quiz.publish-question': {
        // Publishes a real question through D's own device-facing
        // `quizSyncPublish` endpoint (the same one B calls after
        // send-to-projector) — a quiz-app-only screen witness needs a real
        // open publication without spinning up a real B lecture to mint one.
        // Publishing a second question closes whatever was still open,
        // exactly as production does.
        const running = app;
        if (!running) throw new Error('quiz.publish-question requires the quiz service running');
        const now = new Date();
        const publicationId = running.ids.next(now);
        const questionId = running.ids.next(now);
        const options = [
          { id: running.ids.next(now), label: 'A' as const, text: 'Mercury' },
          { id: running.ids.next(now), label: 'B' as const, text: 'Venus' },
          { id: running.ids.next(now), label: 'C' as const, text: 'Earth' },
          { id: running.ids.next(now), label: 'D' as const, text: 'Mars' },
        ];
        const correctOptionId = options[3]!.id;
        const response = await fetch(`${baseUrl}/device/v1/publications`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${deviceBearer}` },
          body: JSON.stringify({
            publicationId, quizSessionId: QUIZ_SESSION_ID, questionId,
            prompt: 'Which planet is known as the Red Planet?', options, correctOptionId,
            publishedAt: now.toISOString(),
          }),
        });
        if (response.status !== 201) throw new Error(`quiz.publish-question: publish returned ${String(response.status)}`);
        return { publicationId, questionId, options, correctOptionId };
      }
      case 'quiz.close-publication': {
        const { publicationId, closeReason } = (input as { publicationId?: unknown; closeReason?: unknown } | undefined) ?? {};
        if (typeof publicationId !== 'string') throw new Error('quiz.close-publication requires publicationId');
        const response = await fetch(`${baseUrl}/device/v1/publications/${publicationId}/close`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${deviceBearer}` },
          body: JSON.stringify({
            publicationId,
            closedAt: new Date().toISOString(),
            closeReason: typeof closeReason === 'string' ? closeReason : 'lecturer-closed',
          }),
        });
        if (response.status !== 204) throw new Error(`quiz.close-publication: close returned ${String(response.status)}`);
        return { closed: true };
      }
      case 'quiz.answer-audit': {
        // Counts durable answer rows D has actually stored, optionally scoped
        // to one publication, so a screen witness can prove a race/retry
        // never produces more than one row per participant.
        const publicationId = (input as { publicationId?: unknown } | undefined)?.publicationId;
        const running = app;
        if (!running) throw new Error('quiz.answer-audit requires the quiz service running');
        const rows = typeof publicationId === 'string'
          ? await running.sql`SELECT count(*)::int AS count FROM answers WHERE publication_id = ${publicationId}`
          : await running.sql`SELECT count(*)::int AS count FROM answers`;
        return { count: Number((rows[0] as { count: number } | undefined)?.count ?? 0) };
      }
      case 'quiz.close-session': {
        // Closes an already-open session through D's own real device-facing
        // `quizSyncCloseSession` endpoint (the same one B calls when a lecture
        // ends) using the credential this process already holds — a screen
        // witness needs a genuinely CLOSED join code without spinning up a
        // real B lecture to get one.
        const targetId = String((input as { quizSessionId?: unknown } | undefined)?.quizSessionId ?? QUIZ_SESSION_ID);
        const response = await fetch(`${baseUrl}/device/v1/quiz-sessions/${targetId}/close`, {
          method: 'POST',
          headers: { authorization: `Bearer ${deviceBearer}` },
        });
        if (response.status !== 204) throw new Error(`quiz.close-session: close returned ${String(response.status)}`);
        return { closed: true };
      }
      case 'quiz.participant-audit': {
        // Counts durable participant rows D has actually stored (optionally
        // scoped to a session), so a screen witness can prove a read-only
        // resolve never created one (INV-QP-1). Reads D's own store.
        const quizSessionId = (input as { quizSessionId?: unknown } | undefined)?.quizSessionId;
        const running = app;
        if (!running) throw new Error('quiz.participant-audit requires the quiz service running');
        const rows = typeof quizSessionId === 'string'
          ? await running.sql`SELECT count(*)::int AS count FROM participants WHERE quiz_session_id = ${quizSessionId}`
          : await running.sql`SELECT count(*)::int AS count FROM participants`;
        return { count: Number((rows[0] as { count: number } | undefined)?.count ?? 0) };
      }
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
