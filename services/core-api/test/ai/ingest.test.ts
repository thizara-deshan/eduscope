import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { lectureSessions, storageVolumes, users } from '../../src/db/schema.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { FakeAiServices } from '../fakes/ai-services.js';
import { FakeClock } from '../fakes/clock.js';
import { FakePipelineManager } from '../fakes/pipeline-manager.js';

const NOW = new Date('2026-08-23T08:00:00.000Z');
const BEARER = 'ai-ingest-test-internal-bearer';
const FIRST_CONSUMER_ID = 'record:00000001';

function fullProvisioning(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    deviceId: 'device-1',
    serialNumber: 'SN-1',
    instituteProfileId: 'institute-1',
    hallCode: 'LAC001',
    hallDisplayName: 'Lecture Hall 1',
    titlePattern: '{hall} – {date} {time}',
    timezone: 'Asia/Colombo',
    ntpServers: [],
    expectedStorageVolumeUuid: null,
    featureFlags: { recordingEnabled: true, aiQuizEnabled: true, streamingEnabled: false },
    quizServerBaseUrl: null,
    llmEndpoint: 'http://127.0.0.1:9/llm',
    provisionedAt: '2026-01-01T00:00:00.000+00:00',
    provisionedBy: 'deploy',
    ...overrides,
  };
}

function writeProvisioning(dir: string, overrides: Record<string, unknown> = {}): string {
  const path = join(dir, 'provisioning.json');
  writeFileSync(path, JSON.stringify(fullProvisioning(overrides)));
  return path;
}

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: condition not met in time');
    await delay(5);
  }
}

interface TestContext {
  dir: string;
  app: FastifyInstance;
  clock: FakeClock;
  pm: FakePipelineManager;
  ai: FakeAiServices;
  ownerToken: string;
}

async function loginAs(app: FastifyInstance, username: string, password: string): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password, client: 'panel' } });
  return (response.json() as { tokens: { accessToken: string } }).tokens.accessToken;
}

async function createContext(): Promise<TestContext> {
  const dir = mkdtempSync(join(tmpdir(), 'core-api-ai-ingest-'));
  const pm = new FakePipelineManager({ bearerToken: BEARER });
  const pmBaseUrl = await pm.listen();
  const ai = new FakeAiServices({ bearerToken: BEARER });
  const aiBaseUrls = await ai.listen();
  const provisioningPath = writeProvisioning(dir);

  const config = loadConfig({
    NODE_ENV: 'test',
    CORE_API_DB_PATH: join(dir, 'core.db'),
    CORE_API_JWT_SECRET: 'ai-ingest-test-secret',
    CORE_API_PROVISIONING_PATH: provisioningPath,
    CORE_API_RECORDINGS_ROOT: join(dir, 'recordings'),
    CORE_API_RUNTIME_DIR: join(dir, 'runtime'),
    CORE_API_PM_BASE_URL: pmBaseUrl,
    CORE_API_INTERNAL_BEARER: BEARER,
  });

  const clock = new FakeClock(NOW);
  const ids = new UlidGenerator();
  const app = await buildApp({ config, clock, ids, aiBaseUrls });
  await app.lifecycle.start();
  await waitFor(() => pm.openConnectionCount === 1);

  const ownerId = ids.next(NOW);
  app.db
    .insert(users)
    .values({
      id: ownerId,
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

  return { dir, app, clock, pm, ai, ownerToken };
}

async function destroyContext(ctx: TestContext): Promise<void> {
  await ctx.app.close();
  await ctx.pm.close();
  await ctx.ai.close();
  rmSync(ctx.dir, { recursive: true, force: true });
}

function currentSession(ctx: TestContext): typeof lectureSessions.$inferSelect {
  return ctx.app.db.select().from(lectureSessions).all()[0]!;
}

async function startAndConfirm(ctx: TestContext): Promise<string> {
  const response = await ctx.app.inject({ method: 'POST', url: '/api/v1/recording/start', headers: { authorization: `Bearer ${ctx.ownerToken}` } });
  expect(response.statusCode).toBe(202);
  await waitFor(() => ctx.pm.calls.some((call) => call.path === '/consumers/record'));
  ctx.pm.publish('evt.pm.consumer.running', { consumerId: FIRST_CONSUMER_ID, pgid: 1 });
  await waitFor(() => currentSession(ctx).state === 'recording');
  return currentSession(ctx).id;
}

async function pauseGracefully(ctx: TestContext): Promise<void> {
  const response = await ctx.app.inject({ method: 'POST', url: '/api/v1/recording/pause', headers: { authorization: `Bearer ${ctx.ownerToken}` } });
  expect(response.statusCode).toBe(202);
  await waitFor(() => ctx.pm.calls.some((call) => call.path === `/consumers/${FIRST_CONSUMER_ID}/stop`));
  ctx.pm.publish('evt.pm.consumer.eos', { consumerId: FIRST_CONSUMER_ID });
  await waitFor(() => currentSession(ctx).state === 'paused');
}

async function resumeAndConfirm(ctx: TestContext): Promise<void> {
  const response = await ctx.app.inject({ method: 'POST', url: '/api/v1/recording/resume', headers: { authorization: `Bearer ${ctx.ownerToken}` } });
  expect(response.statusCode).toBe(202);
  await waitFor(() => ctx.pm.calls.filter((call) => call.path === '/consumers/record').length === 2);
  ctx.pm.publish('evt.pm.consumer.running', { consumerId: 'record:00000002', pgid: 2 });
  await waitFor(() => currentSession(ctx).state === 'recording');
}

async function stopGracefully(ctx: TestContext, consumerId: string = FIRST_CONSUMER_ID): Promise<void> {
  const response = await ctx.app.inject({ method: 'POST', url: '/api/v1/recording/stop', headers: { authorization: `Bearer ${ctx.ownerToken}` } });
  expect(response.statusCode).toBe(202);
  await waitFor(() => ctx.pm.calls.some((call) => call.path === `/consumers/${consumerId}/stop`));
  ctx.pm.publish('evt.pm.consumer.eos', { consumerId });
  await waitFor(() => currentSession(ctx).state === 'completed');
}

describe('AI ingest — pipeline-manager snapshot consumer lifecycle (C execution gate item 2)', () => {
  let ctx: TestContext;

  afterEach(async () => {
    await delay(50);
    await destroyContext(ctx);
  });

  it('starts the snapshot consumer on recording start, stops it on pause, restarts it on resume, stops it on stop', async () => {
    ctx = await createContext();
    const sessionId = await startAndConfirm(ctx);

    await waitFor(() => ctx.pm.calls.some((call) => call.path === '/consumers/snapshot/start'));
    const firstStart = ctx.pm.calls.find((call) => call.path === '/consumers/snapshot/start')!;
    expect(firstStart.body).toEqual({ intervalSec: 1, outputPath: expect.stringContaining(sessionId) });
    expect((firstStart.body as { outputPath: string }).outputPath).toContain('current.png');

    await pauseGracefully(ctx);
    await waitFor(() => ctx.pm.calls.some((call) => call.path === '/consumers/snapshot/stop'));

    await resumeAndConfirm(ctx);
    await waitFor(() => ctx.pm.calls.filter((call) => call.path === '/consumers/snapshot/start').length === 2);

    await stopGracefully(ctx, 'record:00000002'); // resume started a fresh record consumer
    await waitFor(() => ctx.pm.calls.filter((call) => call.path === '/consumers/snapshot/stop').length === 2);
  });
});
