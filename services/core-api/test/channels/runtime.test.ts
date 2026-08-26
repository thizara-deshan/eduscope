import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { FastifyInstance } from 'fastify';
import { zChannelStatePayload, type ChannelStatePayload } from '@eduscope/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { eq } from 'drizzle-orm';
import { channelConfigs, lectureSessions, storageVolumes, users } from '../../src/db/schema.js';
import type { Cancel } from '../../src/lib/clock.js';
import type { RelayTargetActivator } from '../../src/modules/channels/machine.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { FakeClock } from '../fakes/clock.js';
import { FakePipelineManager } from '../fakes/pipeline-manager.js';

const NOW = new Date('2026-05-01T08:00:00.000Z');
const BEARER = 'test-pm-bearer-channels';
const RECORD_CONSUMER_ID = 'record:00000001';

class ChannelClock extends FakeClock {
  readonly sleeps: number[] = [];

  override sleep(ms: number, signal?: AbortSignal): Promise<void> {
    this.sleeps.push(ms);
    return super.sleep(ms, signal);
  }

  override every(ms: number, run: () => void): Cancel {
    return super.every(ms, run);
  }
}

class SpyRelay implements RelayTargetActivator {
  readonly calls: string[] = [];
  failNextActivate = false;

  async activate(streamTargetIds: readonly string[]): Promise<void> {
    this.calls.push(`activate:${streamTargetIds.join(',')}`);
    if (this.failNextActivate) {
      this.failNextActivate = false;
      throw new Error('relay activation refused');
    }
  }

  async deactivate(): Promise<void> {
    this.calls.push('deactivate');
  }
}

// Polls real wall-clock time for an async effect that follows a fake-clock
// advance(). The deadline is generous on purpose: the whole 79-file core-api
// suite runs in parallel, and under CPU contention promise propagation after
// an advance() can take well over a second. A stuck condition still fails —
// just later — so a larger deadline removes load-induced flakes without
// masking a real hang.
async function waitFor(check: () => boolean, timeoutMs = 10000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: condition not met in time');
    await delay(5);
  }
}

function writeProvisioning(dir: string): string {
  const path = join(dir, 'provisioning.json');
  writeFileSync(
    path,
    JSON.stringify({ deviceId: 'device-1', hallCode: 'LAC001', hallDisplayName: 'Lecture Hall 1', titlePattern: '{hall} – {date} {time}' }),
  );
  return path;
}

interface TestContext {
  dir: string;
  app: FastifyInstance;
  clock: ChannelClock;
  pm: FakePipelineManager;
  relay: SpyRelay;
  ownerToken: string;
  otherLecturerToken: string;
  adminToken: string;
  channelEvents: ChannelStatePayload[];
}

async function loginAs(app: FastifyInstance, username: string, password: string): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password, client: 'panel' } });
  return (response.json() as { tokens: { accessToken: string } }).tokens.accessToken;
}

async function createContext(): Promise<TestContext> {
  const dir = mkdtempSync(join(tmpdir(), 'core-api-channels-runtime-'));
  const pm = new FakePipelineManager({ bearerToken: BEARER });
  const pmBaseUrl = await pm.listen();
  const provisioningPath = writeProvisioning(dir);

  const config = loadConfig({
    NODE_ENV: 'test',
    CORE_API_DB_PATH: join(dir, 'core.db'),
    CORE_API_JWT_SECRET: 'channels-runtime-test-secret',
    CORE_API_PROVISIONING_PATH: provisioningPath,
    CORE_API_RECORDINGS_ROOT: join(dir, 'recordings'),
    CORE_API_PM_BASE_URL: pmBaseUrl,
    CORE_API_INTERNAL_BEARER: BEARER,
  });

  const clock = new ChannelClock(NOW);
  const ids = new UlidGenerator();
  const relay = new SpyRelay();
  const app = await buildApp({ config, clock, ids, relay });
  await app.lifecycle.start();
  await waitFor(() => pm.openConnectionCount === 1);

  const channelEvents: ChannelStatePayload[] = [];
  app.bus.subscribe('channel.state', (payload) => channelEvents.push(payload));

  await app.db
    .insert(users)
    .values({
      id: ids.next(NOW),
      username: 'owner',
      displayName: 'Owner Lecturer',
      role: 'lecturer',
      source: 'local',
      passwordHash: await hashPassword('Password1'),
      mustResetPassword: false,
      disabled: false,
      createdAt: NOW.toISOString(),
    })
    .run();
  await app.db
    .insert(users)
    .values({
      id: ids.next(NOW),
      username: 'otherlecturer',
      displayName: 'Other Lecturer',
      role: 'lecturer',
      source: 'local',
      passwordHash: await hashPassword('Password1'),
      mustResetPassword: false,
      disabled: false,
      createdAt: NOW.toISOString(),
    })
    .run();
  await app.db
    .insert(users)
    .values({
      id: ids.next(NOW),
      username: 'admin1',
      displayName: 'Admin One',
      role: 'admin',
      source: 'local',
      passwordHash: await hashPassword('Password1'),
      mustResetPassword: false,
      disabled: false,
      createdAt: NOW.toISOString(),
    })
    .run();
  app.db
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

  const ownerToken = await loginAs(app, 'owner', 'Password1');
  const otherLecturerToken = await loginAs(app, 'otherlecturer', 'Password1');
  const adminToken = await loginAs(app, 'admin1', 'Password1');

  return { dir, app, clock, pm, relay, ownerToken, otherLecturerToken, adminToken, channelEvents };
}

async function destroyContext(ctx: TestContext): Promise<void> {
  await ctx.app.close();
  await ctx.pm.close();
  rmSync(ctx.dir, { recursive: true, force: true });
}

async function post(ctx: TestContext, path: string, accessToken: string): Promise<{ statusCode: number; body: unknown }> {
  const response = await ctx.app.inject({ method: 'POST', url: `/api/v1/channels/${path}`, headers: { authorization: `Bearer ${accessToken}` } });
  return { statusCode: response.statusCode, body: response.json() };
}

async function startSession(ctx: TestContext): Promise<void> {
  await ctx.app.inject({ method: 'POST', url: '/api/v1/recording/start', headers: { authorization: `Bearer ${ctx.ownerToken}` } });
  await waitFor(() => ctx.pm.calls.some((call) => call.path === '/consumers/record'));
  ctx.pm.publish('evt.pm.consumer.running', { consumerId: RECORD_CONSUMER_ID, pgid: 1 });
  await waitFor(() => ctx.app.db.select().from(lectureSessions).all()[0]?.state === 'recording');
}

function setStreamTargets(ctx: TestContext, streamTargetIds: string[]): void {
  ctx.app.db.update(channelConfigs).set({ streamTargetIds }).where(eq(channelConfigs.channelId, 'streaming')).run();
}

function latestState(ctx: TestContext, channelId: 'meeting' | 'streaming'): string | undefined {
  return [...ctx.channelEvents].reverse().find((event) => event.channelId === channelId)?.state;
}

function hasHadState(ctx: TestContext, channelId: 'meeting' | 'streaming', state: string): boolean {
  return ctx.channelEvents.some((event) => event.channelId === channelId && event.state === state);
}

function stopCallFor(ctx: TestContext, consumerId: string): { body?: unknown } | undefined {
  return ctx.pm.calls.find((call) => call.path === `/consumers/${consumerId}/stop`);
}

describe('Channel runtime (machine 1c, CH-01..CH-10)', () => {
  let ctx: TestContext;

  afterEach(async () => {
    await destroyContext(ctx);
  });

  it('local cannot be toggled', async () => {
    ctx = await createContext();
    await startSession(ctx);

    const response = await post(ctx, 'local/enable', ctx.ownerToken);
    expect(response.statusCode).toBe(422);
    expect((response.body as { code: string }).code).toBe('config.invalid');
  });

  it('idle enable returns session.not-active', async () => {
    ctx = await createContext();

    const response = await post(ctx, 'meeting/enable', ctx.ownerToken);
    expect(response.statusCode).toBe(409);
    expect((response.body as { code: string }).code).toBe('session.not-active');
  });

  it('streaming preflight ordering: preflight, relay activation, then PM /consumers/live, then on', async () => {
    ctx = await createContext();
    await startSession(ctx);
    setStreamTargets(ctx, ['target-1']);

    const response = await post(ctx, 'streaming/enable', ctx.ownerToken);
    expect(response.statusCode).toBe(202);

    await waitFor(() => hasHadState(ctx, 'streaming', 'preflight'));
    await waitFor(() => ctx.relay.calls.length > 0);
    await waitFor(() => ctx.pm.calls.some((call) => call.path === '/consumers/live'));

    expect(ctx.relay.calls[0]).toBe('activate:target-1');
    const liveCallIndex = ctx.pm.calls.findIndex((call) => call.path === '/consumers/live');
    const statesSoFar = ctx.channelEvents.filter((event) => event.channelId === 'streaming').map((event) => event.state);
    expect(statesSoFar[0]).toBe('preflight');
    expect(liveCallIndex).toBeGreaterThan(-1);

    const liveConsumerId = 'live:00000001';
    ctx.pm.publish('evt.pm.consumer.running', { consumerId: liveConsumerId, pgid: 5 });
    await waitFor(() => latestState(ctx, 'streaming') === 'on');

    const states = ctx.channelEvents.filter((event) => event.channelId === 'streaming').map((event) => event.state);
    expect(states).toEqual(['preflight', 'starting', 'on']);
  });

  it('meeting direct start: starting then on, no preflight', async () => {
    ctx = await createContext();
    await startSession(ctx);

    const response = await post(ctx, 'meeting/enable', ctx.ownerToken);
    expect(response.statusCode).toBe(202);
    await waitFor(() => ctx.pm.calls.some((call) => call.path === '/consumers/meeting'));

    const statesBeforeConfirm = ctx.channelEvents.filter((event) => event.channelId === 'meeting').map((event) => event.state);
    expect(statesBeforeConfirm).toEqual(['starting']);

    ctx.pm.publish('evt.pm.consumer.running', { consumerId: 'meeting:00000001', pgid: 7 });
    await waitFor(() => latestState(ctx, 'meeting') === 'on');
  });

  it('six-second confirm failure: no evt.pm.consumer.running within T-CHANNEL-START marks failed', async () => {
    ctx = await createContext();
    await startSession(ctx);

    await post(ctx, 'meeting/enable', ctx.ownerToken);
    await waitFor(() => ctx.pm.calls.some((call) => call.path === '/consumers/meeting'));
    await waitFor(() => ctx.clock.sleeps.includes(6000));

    ctx.clock.advance(6000);
    await waitFor(() => latestState(ctx, 'meeting') === 'failed');
  });

  it('isolated stop/restart: disabling meeting does not affect streaming or the active recording', async () => {
    ctx = await createContext();
    await startSession(ctx);

    await post(ctx, 'meeting/enable', ctx.ownerToken);
    await waitFor(() => ctx.pm.calls.some((call) => call.path === '/consumers/meeting'));
    ctx.pm.publish('evt.pm.consumer.running', { consumerId: 'meeting:00000001', pgid: 7 });
    await waitFor(() => latestState(ctx, 'meeting') === 'on');

    const disableResponse = await post(ctx, 'meeting/disable', ctx.ownerToken);
    expect(disableResponse.statusCode).toBe(202);
    await waitFor(() => latestState(ctx, 'meeting') === 'stopping');
    await waitFor(() => stopCallFor(ctx, 'meeting:00000001') !== undefined);
    ctx.pm.publish('evt.pm.consumer.exited', { consumerId: 'meeting:00000001', code: 'stopped' });
    await waitFor(() => latestState(ctx, 'meeting') === 'off');

    expect(ctx.channelEvents.some((event) => event.channelId === 'streaming')).toBe(false);
    expect(ctx.app.db.select().from(lectureSessions).all()[0]?.state).toBe('recording');
  });

  it('owner/admin guard: a non-owner lecturer cannot enable/disable; an admin may', async () => {
    ctx = await createContext();
    await startSession(ctx);

    const otherEnable = await post(ctx, 'meeting/enable', ctx.otherLecturerToken);
    expect(otherEnable.statusCode).toBe(403);
    expect((otherEnable.body as { code: string }).code).toBe('not-authorized');

    const adminEnable = await post(ctx, 'meeting/enable', ctx.adminToken);
    expect(adminEnable.statusCode).toBe(202);
  });

  it('three-attempt restart budget: CH-09 restarts three times then holds failed', async () => {
    ctx = await createContext();
    await startSession(ctx);

    await post(ctx, 'meeting/enable', ctx.ownerToken);
    await waitFor(() => ctx.pm.calls.filter((call) => call.path === '/consumers/meeting').length === 1);
    ctx.pm.publish('evt.pm.consumer.running', { consumerId: 'meeting:00000001', pgid: 1 });
    await waitFor(() => latestState(ctx, 'meeting') === 'on');

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      ctx.pm.publish('evt.pm.consumer.exited', { consumerId: `meeting:${String(attempt).padStart(8, '0')}`, code: 'crashed' });
      await waitFor(() => latestState(ctx, 'meeting') === 'starting');
      ctx.clock.advance(8000); // covers every backoff step (1s, 3s, 8s)
      await waitFor(() => ctx.pm.calls.filter((call) => call.path === '/consumers/meeting').length === attempt + 1);
      ctx.pm.publish('evt.pm.consumer.running', { consumerId: `meeting:${String(attempt + 1).padStart(8, '0')}`, pgid: attempt + 1 });
      await waitFor(() => latestState(ctx, 'meeting') === 'on');
    }

    ctx.pm.publish('evt.pm.consumer.exited', { consumerId: 'meeting:00000004', code: 'crashed' });
    await waitFor(() => latestState(ctx, 'meeting') === 'failed');
    expect(ctx.pm.calls.filter((call) => call.path === '/consumers/meeting').length).toBe(4);
  });

  it('paused recording leaves configured channels on (SM-Q-4, INV-CC-2)', async () => {
    ctx = await createContext();
    await startSession(ctx);

    await post(ctx, 'meeting/enable', ctx.ownerToken);
    await waitFor(() => ctx.pm.calls.some((call) => call.path === '/consumers/meeting'));
    ctx.pm.publish('evt.pm.consumer.running', { consumerId: 'meeting:00000001', pgid: 1 });
    await waitFor(() => latestState(ctx, 'meeting') === 'on');

    await ctx.app.inject({ method: 'POST', url: '/api/v1/recording/pause', headers: { authorization: `Bearer ${ctx.ownerToken}` } });
    await waitFor(() => ctx.pm.calls.some((call) => call.path === `/consumers/${RECORD_CONSUMER_ID}/stop`));
    ctx.pm.publish('evt.pm.consumer.eos', { consumerId: RECORD_CONSUMER_ID });
    await waitFor(() => ctx.app.db.select().from(lectureSessions).all()[0]?.state === 'paused');

    expect(latestState(ctx, 'meeting')).toBe('on');
  });

  it('every emitted runtime state parses as a contract-valid ChannelStatePayload', async () => {
    ctx = await createContext();
    await startSession(ctx);
    setStreamTargets(ctx, ['target-1']);

    await post(ctx, 'streaming/enable', ctx.ownerToken);
    await waitFor(() => ctx.pm.calls.some((call) => call.path === '/consumers/live'));
    ctx.pm.publish('evt.pm.consumer.running', { consumerId: 'live:00000001', pgid: 9 });
    await waitFor(() => latestState(ctx, 'streaming') === 'on');

    await post(ctx, 'streaming/disable', ctx.ownerToken);
    await waitFor(() => latestState(ctx, 'streaming') === 'stopping');
    await waitFor(() => stopCallFor(ctx, 'live:00000001') !== undefined);
    ctx.pm.publish('evt.pm.consumer.exited', { consumerId: 'live:00000001', code: 'stopped' });
    await waitFor(() => latestState(ctx, 'streaming') === 'off');

    expect(ctx.channelEvents.length).toBeGreaterThan(0);
    for (const event of ctx.channelEvents) {
      expect(() => zChannelStatePayload.parse(event)).not.toThrow();
    }
  });
});
