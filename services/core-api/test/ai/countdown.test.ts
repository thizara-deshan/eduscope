import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { FastifyInstance } from 'fastify';
import type { AiCountdownPayload, SystemAlert } from '@eduscope/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { lectureSessions, slideCaptures, storageVolumes, transcriptSegments, users } from '../../src/db/schema.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { FakeAiServices } from '../fakes/ai-services.js';
import { FakeClock } from '../fakes/clock.js';
import { FakePipelineManager } from '../fakes/pipeline-manager.js';

const NOW = new Date('2026-08-20T08:00:00.000Z');
// Production shares one internal bearer across pipeline-manager and the AI services (ai-services.md §0);
// the fixtures reuse the same constant so `config.internalBearer` authenticates both fakes.
const BEARER = 'ai-countdown-test-internal-bearer';
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
  ownerId: string;
  countdownEvents: AiCountdownPayload[];
  alertEvents: SystemAlert[];
  provisioningPath: string;
}

async function loginAs(app: FastifyInstance, username: string, password: string): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password, client: 'panel' } });
  return (response.json() as { tokens: { accessToken: string } }).tokens.accessToken;
}

async function createContext(provisioningOverrides: Record<string, unknown> = {}): Promise<TestContext> {
  const dir = mkdtempSync(join(tmpdir(), 'core-api-ai-countdown-'));
  const pm = new FakePipelineManager({ bearerToken: BEARER });
  const pmBaseUrl = await pm.listen();
  const ai = new FakeAiServices({ bearerToken: BEARER });
  const aiBaseUrls = await ai.listen();
  const provisioningPath = writeProvisioning(dir, provisioningOverrides);

  const config = loadConfig({
    NODE_ENV: 'test',
    CORE_API_DB_PATH: join(dir, 'core.db'),
    CORE_API_JWT_SECRET: 'ai-countdown-test-secret',
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

  const countdownEvents: AiCountdownPayload[] = [];
  app.bus.subscribe('ai.countdown', (payload) => countdownEvents.push(payload));
  const alertEvents: SystemAlert[] = [];
  app.bus.subscribe('system.alert', (payload) => alertEvents.push(payload));

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

  return { dir, app, clock, pm, ai, ownerToken, ownerId, countdownEvents, alertEvents, provisioningPath };
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

async function getCountdownRest(ctx: TestContext): Promise<AiCountdownPayload> {
  const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/ai/countdown', headers: { authorization: `Bearer ${ctx.ownerToken}` } });
  return response.json() as AiCountdownPayload;
}

/** Starts a recording, waits for PM's launch call, and confirms — this also triggers Q-01 (AI arm) and the STT/slide session-start calls. */
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

describe('AI capture ingest and countdown (Q-01..Q-10, machine 2a)', () => {
  let ctx: TestContext;

  afterEach(async () => {
    // Several tests jump the fake clock by whole AI intervals in one call, which
    // fires every intervening HealthAggregator/T-LLM-PROBE tick synchronously;
    // let their real (non-fake-clock) async work settle before tearing down the
    // app, or a late `db.insert` after `app.close()` surfaces as an unhandled
    // rejection instead of a test failure.
    await delay(50);
    await destroyContext(ctx);
  });

  it('Q-01: arms on recording start with the default 20-minute interval and calls stt/slide session-start with anchor 0', async () => {
    ctx = await createContext();
    const sessionId = await startAndConfirm(ctx);

    await waitFor(() => ctx.ai.sttCalls.some((call) => call.path === '/sessions'));
    await waitFor(() => ctx.ai.slideCalls.some((call) => call.path === '/sessions'));

    const sttStart = ctx.ai.sttCalls.find((call) => call.path === '/sessions')!;
    expect(sttStart.body).toEqual({ sessionId, anchorOffsetMs: 0 });
    const slideStart = ctx.ai.slideCalls.find((call) => call.path === '/sessions')!;
    expect((slideStart.body as { sessionId: string }).sessionId).toBe(sessionId);
    expect((slideStart.body as { sourcePath: string }).sourcePath).toContain(sessionId);

    const snapshot = await getCountdownRest(ctx);
    expect(snapshot.state).toBe('armed');
    expect(snapshot.intervalMinutes).toBe(20);
    expect(snapshot.nextAt).toBe(new Date(NOW.getTime() + 20 * 60_000).toISOString());
  });

  it('local nextAt ticking + T-COUNTDOWN-RESYNC: remainingMs decreases and a resync event fires every 15s without a state change', async () => {
    ctx = await createContext();
    await startAndConfirm(ctx);
    const before = ctx.countdownEvents.length;

    ctx.clock.advance(15_000);
    await waitFor(() => ctx.countdownEvents.length > before);
    const resynced = ctx.countdownEvents.at(-1)!;
    expect(resynced.state).toBe('armed');
    expect(resynced.remainingMs).toBeLessThanOrEqual(20 * 60_000 - 15_000);
  });

  it('Q-02: reaching zero requests generation and publishes ai.generation.requested{trigger:countdown}', async () => {
    ctx = await createContext();
    const sessionId = await startAndConfirm(ctx);
    const requested: Array<{ sessionId: string; trigger: string }> = [];
    ctx.app.bus.subscribe('ai.generation.requested', (payload) => requested.push(payload));

    ctx.clock.advance(20 * 60_000);
    await waitFor(() => requested.length > 0);

    expect(requested[0]).toMatchObject({ sessionId, trigger: 'countdown', intervalMinutesAtRequest: 20 });
    const snapshot = await getCountdownRest(ctx);
    expect(snapshot.state).toBe('generating');
  });

  it('Q-04: reportGenerationSettled(ready) resets the countdown to a full interval', async () => {
    ctx = await createContext();
    const sessionId = await startAndConfirm(ctx);
    ctx.clock.advance(20 * 60_000);
    await waitFor(async () => (await getCountdownRest(ctx)).state === 'generating');

    ctx.app.aiCountdown.reportGenerationSettled(sessionId, 'ready');
    const snapshot = await getCountdownRest(ctx);
    expect(snapshot.state).toBe('armed');
    expect(snapshot.remainingMs).toBe(20 * 60_000);
  });

  it('Q-03: generateNow resets the countdown to the full interval and marks the trigger manual', async () => {
    ctx = await createContext();
    const sessionId = await startAndConfirm(ctx);
    ctx.clock.advance(5 * 60_000); // partway through the interval

    const requested: Array<{ sessionId: string; trigger: string }> = [];
    ctx.app.bus.subscribe('ai.generation.requested', (payload) => requested.push(payload));

    const response = await ctx.app.inject({ method: 'POST', url: '/api/v1/ai/generate-now', headers: { authorization: `Bearer ${ctx.ownerToken}` } });
    expect(response.statusCode).toBe(202);
    expect(requested).toEqual([{ sessionId, trigger: 'manual', intervalMinutesAtRequest: 20, requestedAt: expect.any(String) }]);

    ctx.app.aiCountdown.reportGenerationSettled(sessionId, 'ready');
    const snapshot = await getCountdownRest(ctx);
    expect(snapshot.remainingMs).toBe(20 * 60_000);
  });

  it('generateNow refuses while paused (no new transcript) and while already generating', async () => {
    ctx = await createContext();
    await startAndConfirm(ctx);
    await pauseGracefully(ctx);

    const pausedAttempt = await ctx.app.inject({ method: 'POST', url: '/api/v1/ai/generate-now', headers: { authorization: `Bearer ${ctx.ownerToken}` } });
    expect(pausedAttempt.statusCode).toBe(409);

    await resumeAndConfirm(ctx);
    const first = await ctx.app.inject({ method: 'POST', url: '/api/v1/ai/generate-now', headers: { authorization: `Bearer ${ctx.ownerToken}` } });
    expect(first.statusCode).toBe(202);
    const second = await ctx.app.inject({ method: 'POST', url: '/api/v1/ai/generate-now', headers: { authorization: `Bearer ${ctx.ownerToken}` } });
    expect(second.statusCode).toBe(409);
  });

  it('Q-07/Q-08: pause holds the remaining time and resume restores it, resuming stt with anchorOffsetMs = recordedDurationMs', async () => {
    ctx = await createContext();
    await startAndConfirm(ctx);
    ctx.clock.advance(5 * 60_000); // 5 minutes elapsed of the 20-minute interval

    await pauseGracefully(ctx);
    const held = await getCountdownRest(ctx);
    expect(held.state).toBe('held');
    expect(held.remainingMs).toBeCloseTo(15 * 60_000, -3);
    expect(held.nextAt).toBeNull();

    ctx.clock.advance(2 * 60_000); // time passes while paused — must not tick down further

    await resumeAndConfirm(ctx);
    await waitFor(() => ctx.ai.sttCalls.some((call) => call.path.endsWith('/resume')));
    const resumeCall = ctx.ai.sttCalls.find((call) => call.path.endsWith('/resume'))!;
    expect((resumeCall.body as { anchorOffsetMs: number }).anchorOffsetMs).toBe(currentSession(ctx).recordedDurationMs);

    const armedAgain = await getCountdownRest(ctx);
    expect(armedAgain.state).toBe('armed');
    expect(armedAgain.remainingMs).toBeCloseTo(15 * 60_000, -3);
  });

  it('Q-09: stopping the session clears the countdown to unavailable and ends the stt/slide sessions', async () => {
    ctx = await createContext();
    const sessionId = await startAndConfirm(ctx);
    await stopGracefully(ctx);

    await waitFor(() => ctx.ai.sttCalls.some((call) => call.method === 'DELETE'));
    await waitFor(() => ctx.ai.slideCalls.some((call) => call.method === 'DELETE'));
    expect(ctx.ai.sttCalls.find((call) => call.method === 'DELETE')!.path).toBe(`/sessions/${sessionId}`);

    const snapshot = await getCountdownRest(ctx);
    expect(snapshot.state).toBe('unavailable');
    expect(snapshot.remainingMs).toBeNull();
  });

  it('Q-05/Q-06: an exhausted generation degrades and raises an alert; a successful T-LLM-PROBE recovers and clears it', async () => {
    ctx = await createContext();
    const sessionId = await startAndConfirm(ctx);
    ctx.clock.advance(20 * 60_000);
    await waitFor(async () => (await getCountdownRest(ctx)).state === 'generating');

    ctx.ai.setQuestionReachable(false);
    ctx.app.aiCountdown.reportGenerationSettled(sessionId, 'failed-exhausted');

    const degraded = await getCountdownRest(ctx);
    expect(degraded.state).toBe('degraded');
    await waitFor(() => ctx.alertEvents.some((alert) => alert.code === 'ai.unavailable' && alert.clearedAt === null));

    ctx.clock.advance(60_000); // T-LLM-PROBE — still unreachable
    await waitFor(() => ctx.ai.questionCalls.some((call) => call.path.startsWith('/probe')));
    expect((await getCountdownRest(ctx)).state).toBe('degraded');

    ctx.ai.setQuestionReachable(true);
    ctx.clock.advance(60_000); // next T-LLM-PROBE — now reachable
    await waitFor(async () => (await getCountdownRest(ctx)).state === 'armed');
    await waitFor(() => ctx.alertEvents.some((alert) => alert.code === 'ai.unavailable' && alert.clearedAt !== null));

    const recovered = await getCountdownRest(ctx);
    expect(recovered.remainingMs).toBe(20 * 60_000);
  });

  it('setAiInterval accepts only 10/15/20/30 and resets remainingMs to the new interval', async () => {
    ctx = await createContext();
    await startAndConfirm(ctx);

    const invalid = await ctx.app.inject({
      method: 'PUT',
      url: '/api/v1/ai/interval',
      headers: { authorization: `Bearer ${ctx.ownerToken}` },
      payload: { intervalMinutes: 25 },
    });
    expect(invalid.statusCode).toBe(422);

    const valid = await ctx.app.inject({
      method: 'PUT',
      url: '/api/v1/ai/interval',
      headers: { authorization: `Bearer ${ctx.ownerToken}` },
      payload: { intervalMinutes: 10 },
    });
    expect(valid.statusCode).toBe(202);

    const snapshot = await getCountdownRest(ctx);
    expect(snapshot.intervalMinutes).toBe(10);
    expect(snapshot.remainingMs).toBe(10 * 60_000);
  });

  it('appends transcript segments and slide captures append-only from the stt/slide SSE streams', async () => {
    ctx = await createContext();
    const sessionId = await startAndConfirm(ctx);
    await waitFor(() => ctx.ai.sttOpenConnectionCount === 1 && ctx.ai.slideOpenConnectionCount === 1);

    ctx.ai.emitSttSegment({ startOffsetMs: 1000, endOffsetMs: 2500, text: 'hello world', confidence: 0.9, engine: 'vosk', modelVersion: 'v1' });
    ctx.ai.emitSlideCaptured({ capturedAt: NOW.toISOString(), offsetMs: 3000, imagePath: '/tmp/slide-001.png', ocrText: 'Second Law', dedupeHash: 'abc123', isSlideChange: true });

    await waitFor(() => ctx.app.db.select().from(transcriptSegments).all().length === 1);
    await waitFor(() => ctx.app.db.select().from(slideCaptures).all().length === 1);

    const segment = ctx.app.db.select().from(transcriptSegments).all()[0]!;
    expect(segment).toMatchObject({ sessionId, startOffsetMs: 1000, endOffsetMs: 2500, text: 'hello world' });
    const slide = ctx.app.db.select().from(slideCaptures).all()[0]!;
    expect(slide).toMatchObject({ sessionId, offsetMs: 3000, dedupeHash: 'abc123', isSlideChange: true });
  });

  it('G-AI-ENABLED false: the countdown never arms and no stt/slide sessions start', async () => {
    ctx = await createContext({ featureFlags: { recordingEnabled: true, aiQuizEnabled: false, streamingEnabled: false } });
    await startAndConfirm(ctx);
    await delay(20);

    expect(ctx.ai.sttCalls).toHaveLength(0);
    expect(ctx.ai.slideCalls).toHaveLength(0);
    const snapshot = await getCountdownRest(ctx);
    expect(snapshot.state).toBe('unavailable');
  });
});
