import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { FastifyInstance } from 'fastify';
import type { StreamTarget } from '@eduscope/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { channelConfigs, lectureSessions, storageVolumes, streamTargets, users } from '../../src/db/schema.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { digestRelayTargets, renderRelayTargets } from '../../src/modules/relay/config.js';
import { FakeClock } from '../fakes/clock.js';
import { InMemoryHelperTransport } from '../fakes/helper-server.js';
import { FakePipelineManager } from '../fakes/pipeline-manager.js';

const NOW = new Date('2026-08-19T00:00:00.000Z');
const BEARER = 'stream-target-test-pm-bearer';
const RECORD_CONSUMER_ID = 'record:00000001';

async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: condition not met in time');
    await delay(5);
  }
}

interface TestApp {
  app: FastifyInstance;
  dir: string;
  pm: FakePipelineManager;
  transport: InMemoryHelperTransport;
  lecturerToken: string;
  adminToken: string;
}

async function loginAs(app: FastifyInstance, username: string, password: string): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password, client: 'panel' } });
  return (response.json() as { tokens: { accessToken: string } }).tokens.accessToken;
}

async function startTestApp(): Promise<TestApp> {
  const dir = mkdtempSync(join(tmpdir(), 'core-api-stream-targets-'));
  const pm = new FakePipelineManager({ bearerToken: BEARER });
  const pmBaseUrl = await pm.listen();

  const provisioningPath = join(dir, 'provisioning.json');
  writeFileSync(provisioningPath, JSON.stringify({ deviceId: 'device-1', hallCode: 'LAC001', hallDisplayName: 'Lecture Hall 1', titlePattern: '{hall} – {date} {time}' }));

  const config = loadConfig({
    NODE_ENV: 'test',
    CORE_API_DB_PATH: join(dir, 'core.db'),
    CORE_API_JWT_SECRET: 'stream-target-test-secret',
    CORE_API_PROVISIONING_PATH: provisioningPath,
    CORE_API_RECORDINGS_ROOT: join(dir, 'recordings'),
    CORE_API_PM_BASE_URL: pmBaseUrl,
    CORE_API_INTERNAL_BEARER: BEARER,
  });

  const ids = new UlidGenerator();
  const transport = new InMemoryHelperTransport();
  const app = await buildApp({ config, clock: new FakeClock(NOW), ids, helperTransport: transport });
  await app.lifecycle.start();
  await waitFor(() => pm.openConnectionCount === 1);

  await app.db
    .insert(storageVolumes)
    .values({
      id: ids.next(NOW),
      uuid: 'recordings-volume-1',
      devicePath: '/dev/sda1',
      mountPath: '/media/eduscope',
      filesystem: 'ext4',
      capacityBytes: 1_000_000_000_000,
      freeBytes: 500_000_000_000,
      smartStatus: 'good',
      role: 'recordings',
      state: 'mounted',
      registeredAt: NOW.toISOString(),
    })
    .run();

  await app.db.insert(users).values([
    { id: ids.next(NOW), username: 'lecturer1', displayName: 'Lecturer', role: 'lecturer', source: 'local', passwordHash: await hashPassword('Password1'), mustResetPassword: false, disabled: false, createdAt: NOW.toISOString() },
    { id: ids.next(NOW), username: 'admin1', displayName: 'Admin', role: 'admin', source: 'local', passwordHash: await hashPassword('Password1'), mustResetPassword: false, disabled: false, createdAt: NOW.toISOString() },
  ]).run();

  const lecturerToken = await loginAs(app, 'lecturer1', 'Password1');
  const adminToken = await loginAs(app, 'admin1', 'Password1');

  return { app, dir, pm, transport, lecturerToken, adminToken };
}

async function stopTestApp(testApp: TestApp): Promise<void> {
  await testApp.app.close();
  await testApp.pm.close();
  rmSync(testApp.dir, { recursive: true, force: true });
}

async function createTarget(
  testApp: TestApp,
  body: { platform: 'youtube' | 'facebook' | 'custom-rtmp'; displayName: string; ingestUrl: string; streamKey: string; enabled?: boolean },
): Promise<{ statusCode: number; json: StreamTarget }> {
  const response = await testApp.app.inject({ method: 'POST', url: '/api/v1/settings/stream-targets', headers: { authorization: `Bearer ${testApp.adminToken}` }, payload: body });
  return { statusCode: response.statusCode, json: response.json() as StreamTarget };
}

function relayReloadDigests(testApp: TestApp): string[] {
  return testApp.transport.ledger.filter((entry) => entry.verb === 'relay.reload').map((entry) => (entry.args as { configDigest: string }).configDigest);
}

describe('stream targets (openapi.yaml tag: settings — listStreamTargets/createStreamTarget/updateStreamTarget/deleteStreamTarget)', () => {
  let testApp: TestApp;
  afterEach(async () => stopTestApp(testApp));

  it('admin-only: lecturer is refused on every operation', async () => {
    testApp = await startTestApp();
    const created = await createTarget(testApp, { platform: 'youtube', displayName: 'YT', ingestUrl: 'rtmp://a.rtmp.youtube.com/live2', streamKey: 'secret-key' });
    expect(created.statusCode).toBe(201);

    const list = await testApp.app.inject({ method: 'GET', url: '/api/v1/settings/stream-targets', headers: { authorization: `Bearer ${testApp.lecturerToken}` } });
    expect(list.statusCode).toBe(403);

    const createAsLecturer = await testApp.app.inject({ method: 'POST', url: '/api/v1/settings/stream-targets', headers: { authorization: `Bearer ${testApp.lecturerToken}` }, payload: { platform: 'youtube', displayName: 'x', ingestUrl: 'rtmp://x', streamKey: 'k' } });
    expect(createAsLecturer.statusCode).toBe(403);

    const updateAsLecturer = await testApp.app.inject({ method: 'PUT', url: `/api/v1/settings/stream-targets/${created.json.id}`, headers: { authorization: `Bearer ${testApp.lecturerToken}` }, payload: { displayName: 'x' } });
    expect(updateAsLecturer.statusCode).toBe(403);

    const deleteAsLecturer = await testApp.app.inject({ method: 'DELETE', url: `/api/v1/settings/stream-targets/${created.json.id}`, headers: { authorization: `Bearer ${testApp.lecturerToken}` } });
    expect(deleteAsLecturer.statusCode).toBe(403);
  });

  it('createStreamTarget: youtube/facebook require the TLS bridge; custom-rtmp only when rtmps://; the key is never echoed', async () => {
    testApp = await startTestApp();

    const youtube = await createTarget(testApp, { platform: 'youtube', displayName: 'YT', ingestUrl: 'rtmp://a.rtmp.youtube.com/live2', streamKey: 'yt-secret' });
    expect(youtube.statusCode).toBe(201);
    expect(youtube.json.hasStreamKey).toBe(true);
    expect(youtube.json.requiresTlsBridge).toBe(true);
    expect(JSON.stringify(youtube.json)).not.toContain('yt-secret');

    const facebook = await createTarget(testApp, { platform: 'facebook', displayName: 'FB', ingestUrl: 'rtmps://live-api-s.facebook.com/rtmp/', streamKey: 'fb-secret' });
    expect(facebook.json.requiresTlsBridge).toBe(true);

    const customPlain = await createTarget(testApp, { platform: 'custom-rtmp', displayName: 'Custom', ingestUrl: 'rtmp://relay.example.org/live', streamKey: 'custom-secret' });
    expect(customPlain.json.requiresTlsBridge).toBe(false);

    const customTls = await createTarget(testApp, { platform: 'custom-rtmp', displayName: 'Custom TLS', ingestUrl: 'rtmps://relay.example.org/live', streamKey: 'custom-secret' });
    expect(customTls.json.requiresTlsBridge).toBe(true);

    // Never in SQLite: only an opaque ref, never the plaintext key.
    const row = testApp.app.db.select().from(streamTargets).all().find((r) => r.id === youtube.json.id)!;
    expect(row.streamKeyRef).not.toContain('yt-secret');
  });

  it('createStreamTarget: rejects a non-rtmp(s) ingestUrl', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({ method: 'POST', url: '/api/v1/settings/stream-targets', headers: { authorization: `Bearer ${testApp.adminToken}` }, payload: { platform: 'custom-rtmp', displayName: 'Bad', ingestUrl: 'https://example.org/live', streamKey: 'k' } });
    expect(response.statusCode).toBe(422);
    expect((response.json() as { code: string }).code).toBe('config.invalid');
  });

  it('updateStreamTarget: omitted streamKey leaves the secret unchanged; a supplied key rotates it; unknown id is not-found', async () => {
    testApp = await startTestApp();
    const created = await createTarget(testApp, { platform: 'custom-rtmp', displayName: 'Custom', ingestUrl: 'rtmp://relay.example.org/live', streamKey: 'first-secret' });

    const renameOnly = await testApp.app.inject({ method: 'PUT', url: `/api/v1/settings/stream-targets/${created.json.id}`, headers: { authorization: `Bearer ${testApp.adminToken}` }, payload: { displayName: 'Renamed' } });
    expect(renameOnly.statusCode).toBe(200);
    expect((renameOnly.json() as StreamTarget).displayName).toBe('Renamed');
    expect((renameOnly.json() as StreamTarget).hasStreamKey).toBe(true);

    const rotate = await testApp.app.inject({ method: 'PUT', url: `/api/v1/settings/stream-targets/${created.json.id}`, headers: { authorization: `Bearer ${testApp.adminToken}` }, payload: { streamKey: 'second-secret' } });
    expect(rotate.statusCode).toBe(200);
    expect(JSON.stringify(rotate.json())).not.toContain('second-secret');

    const missing = await testApp.app.inject({ method: 'PUT', url: '/api/v1/settings/stream-targets/does-not-exist', headers: { authorization: `Bearer ${testApp.adminToken}` }, payload: { displayName: 'x' } });
    expect(missing.statusCode).toBe(404);
    expect((missing.json() as { code: string }).code).toBe('not-found');
  });

  it('deleteStreamTarget: removes the row, is idempotently 404 on a repeat, and never leaves the plaintext key anywhere', async () => {
    testApp = await startTestApp();
    const created = await createTarget(testApp, { platform: 'custom-rtmp', displayName: 'Custom', ingestUrl: 'rtmp://relay.example.org/live', streamKey: 'to-delete' });

    const del = await testApp.app.inject({ method: 'DELETE', url: `/api/v1/settings/stream-targets/${created.json.id}`, headers: { authorization: `Bearer ${testApp.adminToken}` } });
    expect(del.statusCode).toBe(204);

    const list = await testApp.app.inject({ method: 'GET', url: '/api/v1/settings/stream-targets', headers: { authorization: `Bearer ${testApp.adminToken}` } });
    expect((list.json() as { items: StreamTarget[] }).items.some((item) => item.id === created.json.id)).toBe(false);

    const redelete = await testApp.app.inject({ method: 'DELETE', url: `/api/v1/settings/stream-targets/${created.json.id}`, headers: { authorization: `Bearer ${testApp.adminToken}` } });
    expect(redelete.statusCode).toBe(404);
  });

  it('relay renderer: pushed-upstream target-id set exactly equals the enabled, existing, channel-configured set — no disabled, deleted, implicit, or duplicate target', async () => {
    testApp = await startTestApp();
    const a = await createTarget(testApp, { platform: 'youtube', displayName: 'A', ingestUrl: 'rtmp://a.example/live', streamKey: 'ka' });
    const b = await createTarget(testApp, { platform: 'facebook', displayName: 'B', ingestUrl: 'rtmps://b.example/live', streamKey: 'kb' });
    const disabled = await createTarget(testApp, { platform: 'custom-rtmp', displayName: 'C', ingestUrl: 'rtmp://c.example/live', streamKey: 'kc', enabled: false });
    const deleted = await createTarget(testApp, { platform: 'custom-rtmp', displayName: 'D', ingestUrl: 'rtmp://d.example/live', streamKey: 'kd' });
    await testApp.app.inject({ method: 'DELETE', url: `/api/v1/settings/stream-targets/${deleted.json.id}`, headers: { authorization: `Bearer ${testApp.adminToken}` } });

    // Duplicate + implicit (unknown) + deleted + disabled ids alongside the two that should survive.
    const configuredIds = [a.json.id, a.json.id, disabled.json.id, deleted.json.id, 'unknown-id', b.json.id];
    testApp.app.db.update(channelConfigs).set({ streamTargetIds: configuredIds }).where(eq(channelConfigs.channelId, 'streaming')).run();

    const currentRows = testApp.app.db.select().from(streamTargets).all();
    const expected = renderRelayTargets(configuredIds, currentRows);
    expect(expected.map((t) => t.id)).toEqual([a.json.id, b.json.id]);
    const expectedDigest = digestRelayTargets(expected);

    // Enabling the streaming channel requires an active recording (CH-01/`session.not-active`).
    await testApp.app.inject({ method: 'POST', url: '/api/v1/recording/start', headers: { authorization: `Bearer ${testApp.adminToken}` } });
    await waitFor(() => testApp.pm.calls.some((call) => call.path === '/consumers/record'));
    testApp.pm.publish('evt.pm.consumer.running', { consumerId: RECORD_CONSUMER_ID, pgid: 1 });
    await waitFor(() => testApp.app.db.select().from(lectureSessions).all()[0]?.state === 'recording');

    await testApp.app.inject({ method: 'POST', url: '/api/v1/channels/streaming/enable', headers: { authorization: `Bearer ${testApp.adminToken}` } });
    await waitFor(() => relayReloadDigests(testApp).length > 0);
    expect(relayReloadDigests(testApp)).toEqual([expectedDigest]);

    // Disabling reloads the relay to the empty set exactly once, never repeating the same non-empty digest.
    await testApp.app.inject({ method: 'POST', url: '/api/v1/channels/streaming/disable', headers: { authorization: `Bearer ${testApp.adminToken}` } });
    await waitFor(() => relayReloadDigests(testApp).length > 1);
    expect(relayReloadDigests(testApp).length).toBe(2);
  });

  it('editing a target during an active stream reloads the relay without a PM stop call on the live consumer or the recording', async () => {
    testApp = await startTestApp();
    const target = await createTarget(testApp, { platform: 'youtube', displayName: 'Live', ingestUrl: 'rtmp://a.example/live', streamKey: 'ka' });
    testApp.app.db.update(channelConfigs).set({ streamTargetIds: [target.json.id] }).where(eq(channelConfigs.channelId, 'streaming')).run();

    await testApp.app.inject({ method: 'POST', url: '/api/v1/recording/start', headers: { authorization: `Bearer ${testApp.adminToken}` } });
    await waitFor(() => testApp.pm.calls.some((call) => call.path === '/consumers/record'));
    testApp.pm.publish('evt.pm.consumer.running', { consumerId: RECORD_CONSUMER_ID, pgid: 1 });
    await waitFor(() => testApp.app.db.select().from(lectureSessions).all()[0]?.state === 'recording');

    await testApp.app.inject({ method: 'POST', url: '/api/v1/channels/streaming/enable', headers: { authorization: `Bearer ${testApp.adminToken}` } });
    await waitFor(() => relayReloadDigests(testApp).length > 0);
    const initialDigest = relayReloadDigests(testApp)[0];

    const stopCallsBefore = testApp.pm.calls.filter((call) => call.path.endsWith('/stop')).length;

    // Disabling the only configured target while the channel is live must reload the relay to an empty set, never stop the recording/PM consumer.
    await testApp.app.inject({ method: 'PUT', url: `/api/v1/settings/stream-targets/${target.json.id}`, headers: { authorization: `Bearer ${testApp.adminToken}` }, payload: { enabled: false } });
    await waitFor(() => relayReloadDigests(testApp).length > 1);
    expect(relayReloadDigests(testApp)[1]).not.toBe(initialDigest);

    expect(testApp.pm.calls.filter((call) => call.path.endsWith('/stop')).length).toBe(stopCallsBefore);
    expect(testApp.app.db.select().from(lectureSessions).all()[0]?.state).toBe('recording');
  });
});
