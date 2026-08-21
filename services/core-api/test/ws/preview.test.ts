import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { FastifyInstance } from 'fastify';
import type { PreviewServerMessage, SourcesStatusPayload } from '@eduscope/shared';
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

const NOW = new Date('2026-08-21T00:00:00.000Z');
const BEARER = 'preview-test-pm-bearer';

interface TestApp {
  app: FastifyInstance;
  dir: string;
  pm: FakePipelineManager;
  clock: FakeClock;
  lecturerToken: string;
}

async function login(app: FastifyInstance, username: string): Promise<{ token: string }> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password: 'Password1', client: 'panel' } });
  const token = (response.json() as { tokens: { accessToken: string } }).tokens.accessToken;
  return { token };
}

async function startTestApp(): Promise<TestApp> {
  const dir = mkdtempSync(join(tmpdir(), 'core-api-preview-'));
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
    CORE_API_JWT_SECRET: 'preview-test-secret',
    CORE_API_PROVISIONING_PATH: provisioningPath,
    CORE_API_RECORDINGS_ROOT: join(dir, 'recordings'),
    CORE_API_PM_BASE_URL: pmBaseUrl,
    CORE_API_INTERNAL_BEARER: BEARER,
  });
  const ids = new UlidGenerator();
  const clock = new FakeClock(NOW);
  const app = await buildApp({ config, clock, ids });
  await app.lifecycle.start();
  await waitFor(() => pm.openConnectionCount === 1); // don't race the pm-bridge's first SSE connect (see test/channels/runtime.test.ts)

  await app.db
    .insert(users)
    .values([
      { id: ids.next(NOW), username: 'lecturer1', displayName: 'Lecturer One', role: 'lecturer', source: 'local', passwordHash: await hashPassword('Password1'), mustResetPassword: false, disabled: false, createdAt: NOW.toISOString() },
    ])
    .run();

  const lecturer = await login(app, 'lecturer1');

  return { app, dir, pm, clock, lecturerToken: lecturer.token };
}

async function stopTestApp(testApp: TestApp): Promise<void> {
  await testApp.app.close();
  await testApp.pm.close();
  rmSync(testApp.dir, { recursive: true, force: true });
}

function connect(app: FastifyInstance, protocol: string): Promise<WebSocket> {
  return app.injectWS('/api/v1/ws/preview', { headers: { 'sec-websocket-protocol': protocol } });
}

function collectMessages(ws: WebSocket): PreviewServerMessage[] {
  const messages: PreviewServerMessage[] = [];
  ws.on('message', (data: Buffer) => messages.push(JSON.parse(data.toString()) as PreviewServerMessage));
  return messages;
}

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: condition not met in time');
    await delay(5);
  }
}

async function sourcesStatus(testApp: TestApp): Promise<SourcesStatusPayload[]> {
  const response = await testApp.app.inject({ method: 'GET', url: '/api/v1/sources/status', headers: { authorization: `Bearer ${testApp.lecturerToken}` } });
  return (response.json() as { items: SourcesStatusPayload[] }).items;
}

async function sourceState(testApp: TestApp, roleId: string): Promise<string | undefined> {
  return (await sourcesStatus(testApp)).find((s) => s.roleId === roleId)?.state;
}

/**
 * Advances the fake clock in small steps, yielding to the event loop between
 * each, until `check` passes or `maxSteps` is exhausted. A single blind
 * `clock.advance(bigMs)` can race ahead of a timer an async catch handler
 * hasn't registered with the clock yet (e.g. a reconnect's backoff sleep,
 * armed only after the dropped socket's error propagates through fetch).
 */
async function advanceUntil(testApp: TestApp, check: () => boolean, stepMs: number, maxSteps: number): Promise<void> {
  for (let i = 0; i < maxSteps; i += 1) {
    if (check()) return;
    testApp.clock.advance(stepMs);
    await delay(5);
  }
  if (!check()) throw new Error('advanceUntil: condition not met in time');
}

/**
 * Brings `roleId` to `online` (HL debounce, T-SOURCE-DEBOUNCE=3s off the seeded
 * default-online fake PM status). Idempotent: the single initial resync already
 * brings every bindable role online together, so a second call for a different
 * role must not advance the clock again — doing so would run past T-HEALTH-STALE
 * (6s) with no fresh telemetry and decay every role back to `unknown`.
 */
async function waitForRoleOnline(testApp: TestApp, roleId: string): Promise<void> {
  if ((await sourceState(testApp, roleId)) === 'online') return;
  await waitFor(() => testApp.pm.calls.some((call) => call.path === '/status'));
  testApp.clock.advance(3000);
  await waitFor(async () => (await sourceState(testApp, roleId)) === 'online');
}

describe('preview signaling broker (events.md §3)', () => {
  let testApp: TestApp;

  afterEach(async () => {
    await delay(20);
    await stopTestApp(testApp);
  });

  describe('auth', () => {
    it('rejects a connection with no Sec-WebSocket-Protocol header', async () => {
      testApp = await startTestApp();
      await expect(testApp.app.injectWS('/api/v1/ws/preview')).rejects.toThrow(/401/);
    });

    it('accepts a valid access token as the sole subprotocol value', async () => {
      testApp = await startTestApp();
      const ws = await connect(testApp.app, testApp.lecturerToken);
      ws.close();
    });
  });

  describe('offer/answer/ice negotiation', () => {
    it('rejects an offer for a role with no enabled binding (source-unbound)', async () => {
      testApp = await startTestApp();
      const ws = await connect(testApp.app, testApp.lecturerToken);
      const messages = collectMessages(ws);
      ws.send(JSON.stringify({ type: 'offer', negotiationId: '01ARZ3NDEKTSV4RRFFQ69G5FA1', roleId: 'mic-room', sdp: 'v=0...' }));
      await waitFor(() => messages.length >= 1);
      expect(messages[0]).toEqual({ type: 'error', negotiationId: '01ARZ3NDEKTSV4RRFFQ69G5FA1', code: 'source-unbound', message: expect.any(String) });
      expect(testApp.pm.calls.some((call) => call.path === '/consumers/thumbnails/offer')).toBe(false);
      ws.close();
    });

    it('rejects an offer for a role that is not yet online (source-offline)', async () => {
      testApp = await startTestApp();
      const ws = await connect(testApp.app, testApp.lecturerToken);
      const messages = collectMessages(ws);
      ws.send(JSON.stringify({ type: 'offer', negotiationId: '01ARZ3NDEKTSV4RRFFQ69G5FA1', roleId: 'presentation', sdp: 'v=0...' }));
      await waitFor(() => messages.length >= 1);
      expect(messages[0]).toEqual({ type: 'error', negotiationId: '01ARZ3NDEKTSV4RRFFQ69G5FA1', code: 'source-offline', message: expect.any(String) });
      ws.close();
    });

    it('forwards offer/ice to pipeline-manager and delivers the async answer/ice under 1s', async () => {
      testApp = await startTestApp();
      await waitForRoleOnline(testApp, 'presentation');

      const ws = await connect(testApp.app, testApp.lecturerToken);
      const messages = collectMessages(ws);
      const startedAt = Date.now();
      ws.send(JSON.stringify({ type: 'offer', negotiationId: '01ARZ3NDEKTSV4RRFFQ69G5FA1', roleId: 'presentation', sdp: 'v=0 offer' }));

      await waitFor(() => testApp.pm.calls.some((call) => call.path === '/consumers/thumbnails/offer'));
      const offerCall = testApp.pm.calls.find((call) => call.path === '/consumers/thumbnails/offer')!;
      expect(offerCall.body).toEqual({ negotiationId: '01ARZ3NDEKTSV4RRFFQ69G5FA1', roleId: 'presentation', sdp: 'v=0 offer' });

      testApp.pm.publish('evt.pm.thumbnail.answer', { negotiationId: '01ARZ3NDEKTSV4RRFFQ69G5FA1', sdp: 'v=0 answer' });
      await waitFor(() => messages.some((m) => m.type === 'answer'));
      expect(Date.now() - startedAt).toBeLessThan(1000);
      expect(messages.find((m) => m.type === 'answer')).toEqual({ type: 'answer', negotiationId: '01ARZ3NDEKTSV4RRFFQ69G5FA1', sdp: 'v=0 answer' });

      ws.send(JSON.stringify({ type: 'ice', negotiationId: '01ARZ3NDEKTSV4RRFFQ69G5FA1', candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0 }));
      await waitFor(() => testApp.pm.calls.some((call) => call.path === '/consumers/thumbnails/01ARZ3NDEKTSV4RRFFQ69G5FA1/ice'));

      testApp.pm.publish('evt.pm.thumbnail.ice', { negotiationId: '01ARZ3NDEKTSV4RRFFQ69G5FA1', candidate: 'candidate:2', sdpMid: '0', sdpMLineIndex: 0 });
      await waitFor(() => messages.some((m) => m.type === 'ice'));
      expect(messages.find((m) => m.type === 'ice')).toEqual({ type: 'ice', negotiationId: '01ARZ3NDEKTSV4RRFFQ69G5FA1', candidate: 'candidate:2', sdpMid: '0', sdpMLineIndex: 0 });

      ws.close();
    });

    it('drops a zod-invalid client frame by closing the socket', async () => {
      testApp = await startTestApp();
      const ws = await connect(testApp.app, testApp.lecturerToken);
      const closed = new Promise<number>((resolve) => ws.once('close', (code: number) => resolve(code)));
      ws.send(JSON.stringify({ type: 'not-a-real-type' }));
      expect(await closed).toBe(1008);
    });

    it('closes the previous negotiation when a second offer arrives on the same connection', async () => {
      testApp = await startTestApp();
      await waitForRoleOnline(testApp, 'presentation');
      await waitForRoleOnline(testApp, 'lecturer-cam');

      const ws = await connect(testApp.app, testApp.lecturerToken);
      ws.send(JSON.stringify({ type: 'offer', negotiationId: '01ARZ3NDEKTSV4RRFFQ69G5FA1', roleId: 'presentation', sdp: 'v=0...' }));
      await waitFor(() => testApp.pm.openNegotiationIds.includes('01ARZ3NDEKTSV4RRFFQ69G5FA1'));

      ws.send(JSON.stringify({ type: 'offer', negotiationId: '01ARZ3NDEKTSV4RRFFQ69G5FA2', roleId: 'lecturer-cam', sdp: 'v=0...' }));
      await waitFor(() => testApp.pm.openNegotiationIds.includes('01ARZ3NDEKTSV4RRFFQ69G5FA2'));
      expect(testApp.pm.openNegotiationIds).toEqual(['01ARZ3NDEKTSV4RRFFQ69G5FA2']);
      await waitFor(() => testApp.pm.calls.some((call) => call.method === 'DELETE' && call.path === '/consumers/thumbnails/01ARZ3NDEKTSV4RRFFQ69G5FA1'));

      ws.close();
    });

    it('ignores an ICE candidate for a negotiation id that does not match the connection state', async () => {
      testApp = await startTestApp();
      await waitForRoleOnline(testApp, 'presentation');
      const ws = await connect(testApp.app, testApp.lecturerToken);
      ws.send(JSON.stringify({ type: 'offer', negotiationId: '01ARZ3NDEKTSV4RRFFQ69G5FA1', roleId: 'presentation', sdp: 'v=0...' }));
      await waitFor(() => testApp.pm.openNegotiationIds.includes('01ARZ3NDEKTSV4RRFFQ69G5FA1'));

      ws.send(JSON.stringify({ type: 'ice', negotiationId: '01ARZ3NDEKTSV4RRFFQ69G5FA9', candidate: 'candidate:1', sdpMid: null, sdpMLineIndex: null }));
      await delay(30);
      expect(testApp.pm.calls.some((call) => call.path === '/consumers/thumbnails/01ARZ3NDEKTSV4RRFFQ69G5FA9/ice')).toBe(false);

      ws.close();
    });
  });

  describe('close / teardown', () => {
    it('tears the peer down on an explicit client close', async () => {
      testApp = await startTestApp();
      await waitForRoleOnline(testApp, 'presentation');
      const ws = await connect(testApp.app, testApp.lecturerToken);
      ws.send(JSON.stringify({ type: 'offer', negotiationId: '01ARZ3NDEKTSV4RRFFQ69G5FA1', roleId: 'presentation', sdp: 'v=0...' }));
      await waitFor(() => testApp.pm.openNegotiationIds.includes('01ARZ3NDEKTSV4RRFFQ69G5FA1'));

      ws.send(JSON.stringify({ type: 'close', negotiationId: '01ARZ3NDEKTSV4RRFFQ69G5FA1' }));
      await waitFor(() => !testApp.pm.openNegotiationIds.includes('01ARZ3NDEKTSV4RRFFQ69G5FA1'));

      ws.close();
    });

    it('tears the peer down when the socket disconnects without an explicit close', async () => {
      // injectWS's in-memory duplex pairing never propagates a *client*-initiated
      // close back to the server side (no true close handshake) — a real loopback
      // socket is required to observe server-side disconnect handling (same
      // workaround as panel-hub.test.ts's audio.levels budget-gate test).
      testApp = await startTestApp();
      await waitForRoleOnline(testApp, 'presentation');
      const address = await testApp.app.listen({ host: '127.0.0.1', port: 0 });
      const ws = new WsClient(`${address.replace('http', 'ws')}/api/v1/ws/preview`, testApp.lecturerToken);
      await new Promise<void>((resolve, reject) => {
        ws.once('open', () => resolve());
        ws.once('error', reject);
      });

      ws.send(JSON.stringify({ type: 'offer', negotiationId: '01ARZ3NDEKTSV4RRFFQ69G5FA1', roleId: 'presentation', sdp: 'v=0...' }));
      await waitFor(() => testApp.pm.openNegotiationIds.includes('01ARZ3NDEKTSV4RRFFQ69G5FA1'));

      ws.close();
      await waitFor(() => !testApp.pm.openNegotiationIds.includes('01ARZ3NDEKTSV4RRFFQ69G5FA1'));
    });

    it('errors and tears down an open negotiation when its source goes offline mid-negotiation', async () => {
      testApp = await startTestApp();
      await waitForRoleOnline(testApp, 'presentation');
      const ws = await connect(testApp.app, testApp.lecturerToken);
      const messages = collectMessages(ws);
      ws.send(JSON.stringify({ type: 'offer', negotiationId: '01ARZ3NDEKTSV4RRFFQ69G5FA1', roleId: 'presentation', sdp: 'v=0...' }));
      await waitFor(() => testApp.pm.openNegotiationIds.includes('01ARZ3NDEKTSV4RRFFQ69G5FA1'));

      testApp.pm.setStatus({
        publishers: {
          usb: { state: 'offline', bound: true, fps: null, rms: null, lastError: 'unplugged' },
          rtsp: { state: 'online', bound: true, fps: 30, rms: null, lastError: null },
          rtsp2: { state: 'online', bound: true, fps: 30, rms: null, lastError: null },
          audio: { state: 'online', bound: true, fps: null, rms: 0.1, lastError: null },
        },
      });
      // Publisher telemetry only reaches B-09 via a full `pm.status.resynced` (B-04) — force one by
      // dropping the SSE stream so the bridge reconnects and re-reads `/status`. The reconnect's
      // catch/backoff registration happens asynchronously off the destroyed socket, so nudge the
      // fake clock forward in small steps (rather than one blind `advance`) to avoid racing ahead
      // of the not-yet-registered backoff sleep.
      testApp.pm.dropConnections();
      await advanceUntil(testApp, () => testApp.pm.calls.filter((call) => call.path === '/status').length >= 2, 250, 20);
      await advanceUntil(testApp, () => messages.some((m) => m.type === 'error' && m.code === 'source-offline'), 1_000, 15);
      await waitFor(() => !testApp.pm.openNegotiationIds.includes('01ARZ3NDEKTSV4RRFFQ69G5FA1'));

      ws.close();
    });
  });

  describe('pipeline-manager error mapping', () => {
    it('maps encoder_budget_exceeded to a busy error', async () => {
      testApp = await startTestApp();
      await waitForRoleOnline(testApp, 'presentation');
      testApp.pm.queueThumbnailOfferResponse({ status: 409, body: { code: 'encoder_budget_exceeded', title: 'No free encode session', status: 409 } });

      const ws = await connect(testApp.app, testApp.lecturerToken);
      const messages = collectMessages(ws);
      ws.send(JSON.stringify({ type: 'offer', negotiationId: '01ARZ3NDEKTSV4RRFFQ69G5FA1', roleId: 'presentation', sdp: 'v=0...' }));
      await waitFor(() => messages.length >= 1);
      expect(messages[0]).toEqual({ type: 'error', negotiationId: '01ARZ3NDEKTSV4RRFFQ69G5FA1', code: 'busy', message: expect.any(String) });

      ws.close();
    });

    it('maps an unrecognized pipeline-manager failure to an internal error', async () => {
      testApp = await startTestApp();
      await waitForRoleOnline(testApp, 'presentation');
      testApp.pm.queueThumbnailOfferResponse({ status: 500, body: { code: 'internal', title: 'boom', status: 500 } });

      const ws = await connect(testApp.app, testApp.lecturerToken);
      const messages = collectMessages(ws);
      ws.send(JSON.stringify({ type: 'offer', negotiationId: '01ARZ3NDEKTSV4RRFFQ69G5FA1', roleId: 'presentation', sdp: 'v=0...' }));
      await waitFor(() => messages.length >= 1);
      expect(messages[0]).toEqual({ type: 'error', negotiationId: '01ARZ3NDEKTSV4RRFFQ69G5FA1', code: 'internal', message: expect.any(String) });

      ws.close();
    });
  });

  describe('isolation from recording/other consumers', () => {
    it('never calls a record/live/meeting consumer route', async () => {
      testApp = await startTestApp();
      await waitForRoleOnline(testApp, 'presentation');
      const ws = await connect(testApp.app, testApp.lecturerToken);
      ws.send(JSON.stringify({ type: 'offer', negotiationId: '01ARZ3NDEKTSV4RRFFQ69G5FA1', roleId: 'presentation', sdp: 'v=0...' }));
      await waitFor(() => testApp.pm.openNegotiationIds.includes('01ARZ3NDEKTSV4RRFFQ69G5FA1'));

      expect(testApp.pm.calls.some((call) => call.path === '/consumers/record' || call.path === '/consumers/live' || call.path === '/consumers/meeting')).toBe(false);

      ws.close();
    });
  });
});
