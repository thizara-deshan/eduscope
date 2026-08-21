import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { FastifyInstance } from 'fastify';
import { zPreviewClientMessage, zPreviewServerMessage } from '@eduscope/shared';
import { afterEach, describe, expect, it } from 'vitest';
import type WebSocket from 'ws';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { users } from '../../src/db/schema.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { FakeClock } from '../fakes/clock.js';
import { FakePipelineManager } from '../fakes/pipeline-manager.js';

const NOW = new Date('2026-08-21T00:00:00.000Z');
const BEARER = 'preview-contract-pm-bearer';

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
  const dir = mkdtempSync(join(tmpdir(), 'core-api-preview-contract-'));
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
    CORE_API_JWT_SECRET: 'preview-contract-test-secret',
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

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: condition not met in time');
    await delay(5);
  }
}

async function waitForRoleOnline(testApp: TestApp, roleId: string): Promise<void> {
  await waitFor(() => testApp.pm.calls.some((call) => call.path === '/status'));
  testApp.clock.advance(3000);
  await waitFor(async () => {
    const response = await testApp.app.inject({ method: 'GET', url: '/api/v1/sources/status', headers: { authorization: `Bearer ${testApp.lecturerToken}` } });
    const items = (response.json() as { items: Array<{ roleId: string; state: string }> }).items;
    return items.find((item) => item.roleId === roleId)?.state === 'online';
  });
}

describe('preview signaling contract (events.md §3)', () => {
  let testApp: TestApp;

  afterEach(async () => {
    await delay(20);
    await stopTestApp(testApp);
  });

  it('every raw client/server frame in a full negotiation parses as its exact contract variant', async () => {
    testApp = await startTestApp();
    await waitForRoleOnline(testApp, 'presentation');

    const ws = await connect(testApp.app, testApp.lecturerToken);
    const rawServerFrames: unknown[] = [];
    ws.on('message', (data: Buffer) => rawServerFrames.push(JSON.parse(data.toString())));

    const offer = { type: 'offer', negotiationId: '01ARZ3NDEKTSV4RRFFQ69G5FB1', roleId: 'presentation', sdp: 'v=0 offer' };
    expect(zPreviewClientMessage.safeParse(offer).success).toBe(true);
    ws.send(JSON.stringify(offer));
    await waitFor(() => testApp.pm.calls.some((call) => call.path === '/consumers/thumbnails/offer'));

    testApp.pm.publish('evt.pm.thumbnail.answer', { negotiationId: '01ARZ3NDEKTSV4RRFFQ69G5FB1', sdp: 'v=0 answer' });
    await waitFor(() => rawServerFrames.some((frame) => (frame as { type: string }).type === 'answer'));

    const ice = { type: 'ice', negotiationId: '01ARZ3NDEKTSV4RRFFQ69G5FB1', candidate: 'candidate:1 udp', sdpMid: '0', sdpMLineIndex: 0 };
    expect(zPreviewClientMessage.safeParse(ice).success).toBe(true);
    ws.send(JSON.stringify(ice));
    await waitFor(() => testApp.pm.calls.some((call) => call.path === '/consumers/thumbnails/01ARZ3NDEKTSV4RRFFQ69G5FB1/ice'));

    testApp.pm.publish('evt.pm.thumbnail.ice', { negotiationId: '01ARZ3NDEKTSV4RRFFQ69G5FB1', candidate: 'candidate:2 udp', sdpMid: '0', sdpMLineIndex: 0 });
    await waitFor(() => rawServerFrames.filter((frame) => (frame as { type: string }).type === 'ice').length >= 1);

    const close = { type: 'close', negotiationId: '01ARZ3NDEKTSV4RRFFQ69G5FB1' };
    expect(zPreviewClientMessage.safeParse(close).success).toBe(true);
    ws.send(JSON.stringify(close));
    await waitFor(() => !testApp.pm.openNegotiationIds.includes('01ARZ3NDEKTSV4RRFFQ69G5FB1'));

    // Every frame the broker actually put on the wire parses as its declared PreviewServerMessage variant.
    expect(rawServerFrames.length).toBeGreaterThanOrEqual(2);
    for (const frame of rawServerFrames) {
      const parsed = zPreviewServerMessage.safeParse(frame);
      expect(parsed.success).toBe(true);
    }
    expect(rawServerFrames.some((frame) => (frame as { type: string }).type === 'answer')).toBe(true);
    expect(rawServerFrames.some((frame) => (frame as { type: string }).type === 'ice')).toBe(true);

    ws.close();
  });

  it('an offline-role offer parses as the contract error variant', async () => {
    testApp = await startTestApp();
    const ws = await connect(testApp.app, testApp.lecturerToken);
    const frames: unknown[] = [];
    ws.on('message', (data: Buffer) => frames.push(JSON.parse(data.toString())));

    ws.send(JSON.stringify({ type: 'offer', negotiationId: '01ARZ3NDEKTSV4RRFFQ69G5FB2', roleId: 'presentation', sdp: 'v=0...' }));
    await waitFor(() => frames.length >= 1);

    const parsed = zPreviewServerMessage.safeParse(frames[0]);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toMatchObject({ type: 'error', negotiationId: '01ARZ3NDEKTSV4RRFFQ69G5FB2', code: 'source-offline' });

    ws.close();
  });

  it('leaves recording state untouched by preview negotiation activity', async () => {
    testApp = await startTestApp();
    await waitForRoleOnline(testApp, 'presentation');

    const before = await testApp.app.inject({ method: 'GET', url: '/api/v1/recording/state', headers: { authorization: `Bearer ${testApp.lecturerToken}` } });
    expect(before.json()).toMatchObject({ state: 'idle' });

    const ws = await connect(testApp.app, testApp.lecturerToken);
    ws.send(JSON.stringify({ type: 'offer', negotiationId: '01ARZ3NDEKTSV4RRFFQ69G5FB3', roleId: 'presentation', sdp: 'v=0...' }));
    await waitFor(() => testApp.pm.openNegotiationIds.includes('01ARZ3NDEKTSV4RRFFQ69G5FB3'));
    testApp.pm.publish('evt.pm.thumbnail.answer', { negotiationId: '01ARZ3NDEKTSV4RRFFQ69G5FB3', sdp: 'v=0 answer' });
    ws.send(JSON.stringify({ type: 'close', negotiationId: '01ARZ3NDEKTSV4RRFFQ69G5FB3' }));
    await waitFor(() => !testApp.pm.openNegotiationIds.includes('01ARZ3NDEKTSV4RRFFQ69G5FB3'));

    const after = await testApp.app.inject({ method: 'GET', url: '/api/v1/recording/state', headers: { authorization: `Bearer ${testApp.lecturerToken}` } });
    expect(after.json()).toMatchObject({ state: 'idle' });
    expect(testApp.pm.calls.some((call) => call.path === '/consumers/record' || call.path === '/consumers/live' || call.path === '/consumers/meeting')).toBe(false);

    ws.close();
  });
});
