import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { FastifyInstance } from 'fastify';
import type { EventEnvelope } from '@eduscope/shared';
import { afterEach, describe, expect, it } from 'vitest';
import type WebSocket from 'ws';
import WsClient from 'ws';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { users } from '../../src/db/schema.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { FakeClock } from '../fakes/clock.js';
import { FakePipelineManager } from '../fakes/pipeline-manager.js';

const NOW = new Date('2026-08-20T00:00:00.000Z');
const BEARER = 'panel-hub-test-pm-bearer';

interface TestApp {
  app: FastifyInstance;
  dir: string;
  pm: FakePipelineManager;
  clock: FakeClock;
  lecturerToken: string;
  lecturerSid: string;
  adminToken: string;
  adminSid: string;
}

async function login(app: FastifyInstance, username: string): Promise<{ token: string; sid: string }> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password: 'Password1', client: 'panel' } });
  const token = (response.json() as { tokens: { accessToken: string } }).tokens.accessToken;
  const sid = app.jwt.verify<{ sid: string }>(token).sid;
  return { token, sid };
}

async function startTestApp(): Promise<TestApp> {
  const dir = mkdtempSync(join(tmpdir(), 'core-api-panel-hub-'));
  const pm = new FakePipelineManager({ bearerToken: BEARER });
  const pmBaseUrl = await pm.listen();
  const provisioningPath = join(dir, 'provisioning.json');
  writeFileSync(
    provisioningPath,
    JSON.stringify({ deviceId: 'device-1', hallCode: 'LAC001', hallDisplayName: 'Lecture Hall 1', titlePattern: '{hall} – {date} {time}' }),
  );

  const config = loadConfig({
    NODE_ENV: 'test',
    CORE_API_DB_PATH: join(dir, 'core.db'),
    CORE_API_JWT_SECRET: 'panel-hub-test-secret',
    CORE_API_PROVISIONING_PATH: provisioningPath,
    CORE_API_RECORDINGS_ROOT: join(dir, 'recordings'),
    CORE_API_PM_BASE_URL: pmBaseUrl,
    CORE_API_INTERNAL_BEARER: BEARER,
  });
  const ids = new UlidGenerator();
  const clock = new FakeClock(NOW);
  const app = await buildApp({ config, clock, ids });
  await app.lifecycle.start();

  await app.db
    .insert(users)
    .values([
      { id: ids.next(NOW), username: 'lecturer1', displayName: 'Lecturer One', role: 'lecturer', source: 'local', passwordHash: await hashPassword('Password1'), mustResetPassword: false, disabled: false, createdAt: NOW.toISOString() },
      { id: ids.next(NOW), username: 'admin1', displayName: 'Admin One', role: 'admin', source: 'local', passwordHash: await hashPassword('Password1'), mustResetPassword: false, disabled: false, createdAt: NOW.toISOString() },
      { id: ids.next(NOW), username: 'reset-me', displayName: 'Reset Me', role: 'lecturer', source: 'local', passwordHash: await hashPassword('Password1'), mustResetPassword: true, disabled: false, createdAt: NOW.toISOString() },
    ])
    .run();

  const lecturer = await login(app, 'lecturer1');
  const admin = await login(app, 'admin1');

  return { app, dir, pm, clock, lecturerToken: lecturer.token, lecturerSid: lecturer.sid, adminToken: admin.token, adminSid: admin.sid };
}

async function stopTestApp(testApp: TestApp): Promise<void> {
  await testApp.app.close();
  await testApp.pm.close();
  rmSync(testApp.dir, { recursive: true, force: true });
}

function connect(app: FastifyInstance, protocol: string): Promise<WebSocket> {
  return app.injectWS('/api/v1/ws', { headers: { 'sec-websocket-protocol': protocol } });
}

function collectFrames(ws: WebSocket): EventEnvelope[] {
  const frames: EventEnvelope[] = [];
  ws.on('message', (data: Buffer) => frames.push(JSON.parse(data.toString()) as EventEnvelope));
  return frames;
}

async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: condition not met in time');
    await delay(5);
  }
}

function waitForClose(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    ws.once('close', (code: number, reasonBuf: Buffer) => resolve({ code, reason: reasonBuf.toString() }));
  });
}

describe('panel WS hub (events.md §1/§2)', () => {
  let testApp: TestApp;

  afterEach(async () => {
    await delay(20);
    await stopTestApp(testApp);
  });

  describe('auth', () => {
    it('rejects a connection with no Sec-WebSocket-Protocol header', async () => {
      testApp = await startTestApp();
      await expect(testApp.app.injectWS('/api/v1/ws')).rejects.toThrow(/401/);
    });

    it('rejects a malformed/unverifiable token', async () => {
      testApp = await startTestApp();
      await expect(connect(testApp.app, 'not-a-real-jwt')).rejects.toThrow(/401/);
    });

    it('rejects more than one offered subprotocol value (the raw JWT must be the sole value)', async () => {
      testApp = await startTestApp();
      await expect(connect(testApp.app, `${testApp.lecturerToken}, extra-value`)).rejects.toThrow(/401/);
    });

    it('rejects a revoked (logged-out) session', async () => {
      testApp = await startTestApp();
      const logout = await testApp.app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { authorization: `Bearer ${testApp.lecturerToken}` } });
      expect(logout.statusCode).toBe(204);
      await expect(connect(testApp.app, testApp.lecturerToken)).rejects.toThrow(/401/);
    });

    it('rejects a reset-locked account outright (no partial WS allowlist)', async () => {
      testApp = await startTestApp();
      const { token } = await login(testApp.app, 'reset-me');
      await expect(connect(testApp.app, token)).rejects.toThrow(/403/);
    });

    it('accepts a valid access token as the sole subprotocol value', async () => {
      testApp = await startTestApp();
      const ws = await connect(testApp.app, testApp.lecturerToken);
      ws.close();
    });
  });

  describe('initial snapshot', () => {
    it('emits the full on-subscribe snapshot in order, then nothing else, for a fresh idle device', async () => {
      testApp = await startTestApp();
      const ws = await connect(testApp.app, testApp.lecturerToken);
      const frames = collectFrames(ws);

      // recording.state(1) + channel.state x3 + sources.status x5 (seeded roles) + storage.status(1) + device.health(1) + ai.countdown(1) + quiz.session(1) = 13
      await waitFor(() => frames.length >= 13);
      await delay(30);
      expect(frames.length).toBe(13);

      expect(frames[0]!.event).toBe('recording.state');
      expect(frames[0]!.payload).toMatchObject({ state: 'idle', sessionId: null });

      const channelFrames = frames.slice(1, 4);
      expect(channelFrames.every((f) => f.event === 'channel.state')).toBe(true);
      expect(new Set(channelFrames.map((f) => (f.payload as { channelId: string }).channelId))).toEqual(new Set(['local', 'meeting', 'streaming']));

      const sourceFrames = frames.slice(4, 9);
      expect(sourceFrames.every((f) => f.event === 'sources.status')).toBe(true);
      expect(sourceFrames.length).toBe(5);

      expect(frames[9]!.event).toBe('storage.status');
      expect(frames[10]!.event).toBe('device.health');
      expect(frames[11]!.event).toBe('ai.countdown');
      expect(frames[12]!.event).toBe('quiz.session');

      // No current ai.set / open quiz.publication (no session yet) and no alert on a fresh device.
      expect(frames.some((f) => f.event === 'ai.set')).toBe(false);
      expect(frames.some((f) => f.event === 'quiz.publication')).toBe(false);
      expect(frames.some((f) => f.event === 'system.alert')).toBe(false);

      ws.close();
    });

    it('always includes quiz.session (absent state) even with no quiz session', async () => {
      testApp = await startTestApp();
      const ws = await connect(testApp.app, testApp.lecturerToken);
      const frames = collectFrames(ws);
      await waitFor(() => frames.some((f) => f.event === 'quiz.session'));
      const quizFrame = frames.find((f) => f.event === 'quiz.session')!;
      expect(quizFrame.payload).toMatchObject({ state: 'absent', quizSessionId: null });
      ws.close();
    });

    it('assigns a monotonic per-connection seq starting at 0, and a reconnect gets a fresh snapshot starting again at seq 0', async () => {
      testApp = await startTestApp();
      const wsA = await connect(testApp.app, testApp.lecturerToken);
      const framesA = collectFrames(wsA);
      await waitFor(() => framesA.length >= 13);
      await delay(20);
      const seqsA = framesA.map((f) => f.seq);
      expect(seqsA).toEqual([...seqsA].sort((a, b) => a - b));
      expect(new Set(seqsA).size).toBe(seqsA.length);
      expect(seqsA[0]).toBe(0);
      wsA.close();

      const wsB = await connect(testApp.app, testApp.lecturerToken);
      const framesB = collectFrames(wsB);
      await waitFor(() => framesB.length >= 13);
      await delay(20);
      expect(framesB[0]!.seq).toBe(0);
      wsB.close();
    });
  });

  describe('broadcast fan-out', () => {
    it('delivers a live delta exactly once to every connected panel/admin connection', async () => {
      testApp = await startTestApp();
      const wsLecturer = await connect(testApp.app, testApp.lecturerToken);
      const wsAdmin = await connect(testApp.app, testApp.adminToken);
      const framesLecturer = collectFrames(wsLecturer);
      const framesAdmin = collectFrames(wsAdmin);
      await waitFor(() => framesLecturer.length >= 13 && framesAdmin.length >= 13);

      testApp.app.bus.publish('storage.status', { pressure: 'ok', freeBytes: 1, totalBytes: 2, policy: { maxAgeDays: 14, warningThresholdPct: 80, criticalThresholdPct: 90, earlyDeleteOrder: 'uploaded-oldest-first', neverDeleteUnuploaded: true, refuseStartWhenCritical: true } });

      await waitFor(() => framesLecturer.length >= 14 && framesAdmin.length >= 14);
      await delay(30);
      expect(framesLecturer.length).toBe(14);
      expect(framesAdmin.length).toBe(14);
      expect(framesLecturer.at(-1)!.event).toBe('storage.status');
      expect(framesAdmin.at(-1)!.event).toBe('storage.status');

      wsLecturer.close();
      wsAdmin.close();
    });

    it('closes the connection instead of sending anything when a panel connection sends a frame (server->client only)', async () => {
      testApp = await startTestApp();
      const ws = await connect(testApp.app, testApp.lecturerToken);
      await delay(50); // let the snapshot burst finish before sending an out-of-protocol frame
      const closed = waitForClose(ws);
      ws.send('unexpected client frame');
      const { code } = await closed;
      expect(code).toBe(1008);
    });
  });

  describe('scoped streams (export.job, usb.volumes, log.entry)', () => {
    it('delivers export.job only to the AuthSession subscribed via the CG-3 scoped registry', async () => {
      testApp = await startTestApp();
      const wsSubscribed = await connect(testApp.app, testApp.lecturerToken);
      const wsOther = await connect(testApp.app, testApp.adminToken);
      const framesSubscribed = collectFrames(wsSubscribed);
      const framesOther = collectFrames(wsOther);
      await waitFor(() => framesSubscribed.length >= 13 && framesOther.length >= 13);

      const jobId = new UlidGenerator().next(NOW);
      testApp.app.scopedSubscriptions.refresh(testApp.lecturerSid, 'export.job', jobId);
      testApp.app.bus.publish('export.job', { jobId, state: 'copying', bytesCopied: 1, bytesTotal: 2, error: null });

      await waitFor(() => framesSubscribed.some((f) => f.event === 'export.job'));
      await delay(30);
      expect(framesOther.some((f) => f.event === 'export.job')).toBe(false);

      wsSubscribed.close();
      wsOther.close();
    });

    it('delivers usb.volumes only to sessions with the export flow open', async () => {
      testApp = await startTestApp();
      const wsSubscribed = await connect(testApp.app, testApp.lecturerToken);
      const wsOther = await connect(testApp.app, testApp.adminToken);
      const framesSubscribed = collectFrames(wsSubscribed);
      const framesOther = collectFrames(wsOther);
      await waitFor(() => framesSubscribed.length >= 13 && framesOther.length >= 13);

      testApp.app.scopedSubscriptions.refresh(testApp.lecturerSid, 'usb.volumes');
      testApp.app.bus.publish('usb.volumes', { volumes: [] });

      await waitFor(() => framesSubscribed.some((f) => f.event === 'usb.volumes'));
      await delay(30);
      expect(framesOther.some((f) => f.event === 'usb.volumes')).toBe(false);

      wsSubscribed.close();
      wsOther.close();
    });

    it('delivers log.entry only to sessions with the live log view open', async () => {
      testApp = await startTestApp();
      const wsSubscribed = await connect(testApp.app, testApp.lecturerToken);
      const wsOther = await connect(testApp.app, testApp.adminToken);
      const framesSubscribed = collectFrames(wsSubscribed);
      const framesOther = collectFrames(wsOther);
      await waitFor(() => framesSubscribed.length >= 13 && framesOther.length >= 13);

      testApp.app.scopedSubscriptions.refresh(testApp.lecturerSid, 'log.entry');
      testApp.app.bus.publish('log.entry', { id: new UlidGenerator().next(NOW), at: NOW.toISOString(), level: 'INFO', category: 'System', service: 'core-api', message: 'hello', context: null, sessionId: null, userId: null });

      await waitFor(() => framesSubscribed.some((f) => f.event === 'log.entry'));
      await delay(30);
      expect(framesOther.some((f) => f.event === 'log.entry')).toBe(false);

      wsSubscribed.close();
      wsOther.close();
    });

    it('expires a scoped subscription after its 120-second TTL', async () => {
      testApp = await startTestApp();
      const ws = await connect(testApp.app, testApp.lecturerToken);
      const frames = collectFrames(ws);
      await waitFor(() => frames.length >= 13);

      const jobId = new UlidGenerator().next(NOW);
      testApp.app.scopedSubscriptions.refresh(testApp.lecturerSid, 'export.job', jobId);
      testApp.clock.advance(120_001);

      const before = frames.length;
      testApp.app.bus.publish('export.job', { jobId, state: 'copying', bytesCopied: 1, bytesTotal: 2, error: null });
      await delay(50);
      expect(frames.slice(before).some((f) => f.event === 'export.job')).toBe(false);

      ws.close();
    });
  });

  describe('audio.levels budget gate (B-09 listenerCount)', () => {
    // A real loopback socket: injectWS's in-memory duplex pairing never
    // propagates a *client*-initiated close back to the server side (its
    // synthetic transport has no true close handshake), so it can't observe
    // the server noticing a disconnect and dropping the bus subscription.
    it('subscribes to the bus only while >=1 panel connection is open, and drops the subscription once the last one disconnects', async () => {
      testApp = await startTestApp();
      expect(testApp.app.bus.listenerCount('audio.levels')).toBe(0);

      const address = await testApp.app.listen({ host: '127.0.0.1', port: 0 });
      const ws = new WsClient(`${address.replace('http', 'ws')}/api/v1/ws`, testApp.lecturerToken);
      const frames = collectFrames(ws);
      await new Promise<void>((resolve, reject) => {
        ws.once('open', () => resolve());
        ws.once('error', reject);
      });
      await waitFor(() => frames.length >= 13);
      expect(testApp.app.bus.listenerCount('audio.levels')).toBe(1);

      testApp.app.bus.publish('audio.levels', { roleId: 'presentation', rms: 0.5 });
      await waitFor(() => frames.some((f) => f.event === 'audio.levels'));

      ws.close();
      await waitFor(() => testApp.app.bus.listenerCount('audio.levels') === 0);
    });
  });

  describe('backpressure', () => {
    it('closes the connection once more than 256 events are queued without being drained', async () => {
      testApp = await startTestApp();
      const ws = await connect(testApp.app, testApp.lecturerToken);
      await waitFor(() => collectFrames(ws).length >= 0);
      const closed = waitForClose(ws);

      // Publish synchronously, in one microtask burst, faster than the fake in-memory
      // transport's send() callbacks can drain the queue — the 257th enqueue trips the cap.
      for (let i = 0; i < 260; i += 1) {
        testApp.app.bus.publish('storage.status', { pressure: 'ok', freeBytes: i, totalBytes: 2, policy: { maxAgeDays: 14, warningThresholdPct: 80, criticalThresholdPct: 90, earlyDeleteOrder: 'uploaded-oldest-first', neverDeleteUnuploaded: true, refuseStartWhenCritical: true } });
      }

      const { code } = await closed;
      expect(code).toBe(1008);
    });

    it('closes the connection once a single event would exceed the 1 MiB queued-byte cap', async () => {
      testApp = await startTestApp();
      const ws = await connect(testApp.app, testApp.lecturerToken);
      await waitFor(() => collectFrames(ws).length >= 0);
      const closed = waitForClose(ws);

      testApp.app.alertStore.raise({ code: 'test.oversized', severity: 'info', category: 'System', title: 'oversized', detail: 'x'.repeat(2_000_000) });

      const { code } = await closed;
      expect(code).toBe(1008);
    });
  });

  describe('graceful shutdown (B-35/B-36 lifecycle row)', () => {
    it('closes active connections and rejects new upgrades once the hub has stopped', async () => {
      testApp = await startTestApp();
      const ws = await connect(testApp.app, testApp.lecturerToken);
      const closed = waitForClose(ws);
      // `lifecycle.stop()` is idempotent (LifecycleRegistry caches the promise), so this
      // also exercises exactly what app.close()'s onClose hook triggers, without racing
      // afterEach's own app.close() call.
      await testApp.app.lifecycle.stop();
      await closed;
    });
  });
});
