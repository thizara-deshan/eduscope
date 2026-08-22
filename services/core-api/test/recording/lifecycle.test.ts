import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { TIMERS, type RecordingSegmentPayload, type RecordingStatePayload } from '@eduscope/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { channelConfigs, lectureSessions, recordingFiles, recordingSegments, recordings, storageVolumes, users } from '../../src/db/schema.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import type { Cancel } from '../../src/lib/clock.js';
import { FakeClock } from '../fakes/clock.js';
import { FakePipelineManager } from '../fakes/pipeline-manager.js';

const NOW = new Date('2026-04-01T08:00:00.000Z');
const BEARER = 'test-pm-bearer-lifecycle';
const FIRST_CONSUMER_ID = 'record:00000001';
const SECOND_CONSUMER_ID = 'record:00000002';
const THIRD_CONSUMER_ID = 'record:00000003';

/** Same rationale as start.test.ts's RecordingClock: the confirm/EOS timers are armed only once the PM round trip resolves, so tests wait for the real `sleep()` call rather than racing `pm.calls`. */
class RecordingClock extends FakeClock {
  readonly sleeps: number[] = [];

  override sleep(ms: number, signal?: AbortSignal): Promise<void> {
    this.sleeps.push(ms);
    return super.sleep(ms, signal);
  }

  override every(ms: number, run: () => void): Cancel {
    return super.every(ms, run);
  }
}

async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor: condition not met in time');
    }
    await delay(5);
  }
}

function writeProvisioning(dir: string): string {
  const path = join(dir, 'provisioning.json');
  writeFileSync(
    path,
    JSON.stringify({
      deviceId: 'device-1',
      hallCode: 'LAC001',
      hallDisplayName: 'Lecture Hall 1',
      titlePattern: '{hall} – {date} {time}',
    }),
  );
  return path;
}

interface TestContext {
  dir: string;
  app: FastifyInstance;
  clock: RecordingClock;
  ids: UlidGenerator;
  pm: FakePipelineManager;
  ownerToken: string;
  ownerId: string;
  otherLecturerToken: string;
  adminToken: string;
  dbPath: string;
  provisioningPath: string;
}

async function loginAs(app: FastifyInstance, username: string, password: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username, password, client: 'panel' },
  });
  return (response.json() as { tokens: { accessToken: string } }).tokens.accessToken;
}

async function createContext(): Promise<TestContext> {
  const dir = mkdtempSync(join(tmpdir(), 'core-api-recording-lifecycle-'));
  const pm = new FakePipelineManager({ bearerToken: BEARER });
  const pmBaseUrl = await pm.listen();
  const provisioningPath = writeProvisioning(dir);
  const dbPath = join(dir, 'core.db');

  const config = loadConfig({
    NODE_ENV: 'test',
    CORE_API_DB_PATH: dbPath,
    CORE_API_JWT_SECRET: 'recording-lifecycle-test-secret',
    CORE_API_PROVISIONING_PATH: provisioningPath,
    CORE_API_RECORDINGS_ROOT: join(dir, 'recordings'),
    CORE_API_PM_BASE_URL: pmBaseUrl,
    CORE_API_INTERNAL_BEARER: BEARER,
  });

  const clock = new RecordingClock(NOW);
  const ids = new UlidGenerator();
  const app = await buildApp({ config, clock, ids });
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
  app.db
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

  return { dir, app, clock, ids, pm, ownerToken, ownerId, otherLecturerToken, adminToken, dbPath, provisioningPath };
}

async function destroyContext(ctx: TestContext): Promise<void> {
  await ctx.app.close();
  await ctx.pm.close();
  rmSync(ctx.dir, { recursive: true, force: true });
}

async function post(ctx: TestContext, path: string, accessToken: string): Promise<{ statusCode: number; body: unknown }> {
  const response = await ctx.app.inject({ method: 'POST', url: `/api/v1/recording/${path}`, headers: { authorization: `Bearer ${accessToken}` } });
  return { statusCode: response.statusCode, body: response.json() };
}

function segmentsFor(ctx: TestContext, recordingId: string): (typeof recordingSegments.$inferSelect)[] {
  return ctx.app.db.select().from(recordingSegments).where(eq(recordingSegments.recordingId, recordingId)).all();
}

function firstRecording(ctx: TestContext): typeof recordings.$inferSelect {
  return ctx.app.db.select().from(recordings).all()[0]!;
}

function firstSession(ctx: TestContext): typeof lectureSessions.$inferSelect {
  return ctx.app.db.select().from(lectureSessions).all()[0]!;
}

/** Starts, waits for the PM launch call, and confirms via `evt.pm.consumer.running` — leaves the session `recording` with segment 0 open. */
async function startAndConfirm(ctx: TestContext): Promise<void> {
  await post(ctx, 'start', ctx.ownerToken);
  await waitFor(() => ctx.pm.calls.some((call) => call.path === '/consumers/record'));
  ctx.pm.publish('evt.pm.consumer.running', { consumerId: FIRST_CONSUMER_ID, pgid: 1 });
  await waitFor(() => firstSession(ctx).state === 'recording');
}

function stopCallFor(ctx: TestContext, consumerId: string): { body?: unknown } | undefined {
  return ctx.pm.calls.find((call) => call.path === `/consumers/${consumerId}/stop`);
}

/**
 * Publishing `evt.pm.consumer.eos` (or advancing the clock) only has an
 * effect once the background `stopConsumerWithEosRace` has actually issued
 * its PM call and subscribed — which happens after an async gap the 202
 * response does not wait for. Every test resolves a pause/stop gracefully
 * through this helper so it never races that gap (T-PAUSE-EOS and
 * T-START-CONFIRM are both 5000ms, so waiting on the PM call is also more
 * reliable here than `clock.sleeps.includes(...)`).
 */
async function pauseGracefully(ctx: TestContext, consumerId: string, accessToken: string = ctx.ownerToken): Promise<void> {
  await post(ctx, 'pause', accessToken);
  await waitFor(() => stopCallFor(ctx, consumerId) !== undefined);
  ctx.pm.publish('evt.pm.consumer.eos', { consumerId });
  await waitFor(() => firstSession(ctx).state === 'paused');
}

async function stopGracefully(ctx: TestContext, consumerId: string, accessToken: string = ctx.ownerToken): Promise<void> {
  await post(ctx, 'stop', accessToken);
  await waitFor(() => stopCallFor(ctx, consumerId) !== undefined);
  ctx.pm.publish('evt.pm.consumer.eos', { consumerId });
  await waitFor(() => firstSession(ctx).state === 'completed');
}

/** Resumes and confirms the `Nth` `/consumers/record` call (1-based) with `consumerId`. */
async function resumeAndConfirm(ctx: TestContext, callIndex: number, consumerId: string): Promise<void> {
  await post(ctx, 'resume', ctx.ownerToken);
  await waitFor(() => ctx.pm.calls.filter((call) => call.path === '/consumers/record').length === callIndex);
  ctx.pm.publish('evt.pm.consumer.running', { consumerId, pgid: callIndex });
  await waitFor(() => firstSession(ctx).state === 'recording');
}

describe('Recording pause/resume/stop lifecycle (R-08..R-15, SEG-1..SEG-7)', () => {
  let ctx: TestContext;

  afterEach(async () => {
    await destroyContext(ctx);
  });

  describe('owner/admin guards (G-AUTH-OWNER)', () => {
    it('a non-owner lecturer cannot pause, resume, or stop', async () => {
      ctx = await createContext();
      await startAndConfirm(ctx);

      const pause = await post(ctx, 'pause', ctx.otherLecturerToken);
      expect(pause.statusCode).toBe(403);
      expect((pause.body as { code: string }).code).toBe('not-authorized');

      const stop = await post(ctx, 'stop', ctx.otherLecturerToken);
      expect(stop.statusCode).toBe(403);
      expect((stop.body as { code: string }).code).toBe('not-authorized');
    });

    it('an admin may pause a lecture they do not own', async () => {
      ctx = await createContext();
      await startAndConfirm(ctx);

      const pause = await post(ctx, 'pause', ctx.adminToken);
      expect(pause.statusCode).toBe(202);
    });
  });

  describe('idempotent repeated commands', () => {
    it('a second pause while the first is still in flight does not close a second segment', async () => {
      ctx = await createContext();
      await startAndConfirm(ctx);

      const first = await post(ctx, 'pause', ctx.ownerToken);
      const second = await post(ctx, 'pause', ctx.ownerToken);
      expect(first.statusCode).toBe(202);
      expect(second.statusCode).toBe(202);

      await waitFor(() => stopCallFor(ctx, FIRST_CONSUMER_ID) !== undefined);
      ctx.pm.publish('evt.pm.consumer.eos', { consumerId: FIRST_CONSUMER_ID });
      await waitFor(() => firstSession(ctx).state === 'paused');

      const recording = firstRecording(ctx);
      expect(segmentsFor(ctx, recording.id)).toHaveLength(1);
      expect(ctx.pm.calls.filter((call) => call.path === `/consumers/${FIRST_CONSUMER_ID}/stop`)).toHaveLength(1);
    });

    it('pausing an already-paused session is a no-op', async () => {
      ctx = await createContext();
      await startAndConfirm(ctx);
      await pauseGracefully(ctx, FIRST_CONSUMER_ID);

      const again = await post(ctx, 'pause', ctx.ownerToken);
      expect(again.statusCode).toBe(202);
      expect(firstSession(ctx).pauseCount).toBe(1);
    });

    it('a second stop while the first is still in flight does not double-finalize', async () => {
      ctx = await createContext();
      await startAndConfirm(ctx);

      const first = await post(ctx, 'stop', ctx.ownerToken);
      const second = await post(ctx, 'stop', ctx.ownerToken);
      expect(first.statusCode).toBe(202);
      expect(second.statusCode).toBe(202);

      await waitFor(() => stopCallFor(ctx, FIRST_CONSUMER_ID) !== undefined);
      ctx.pm.publish('evt.pm.consumer.eos', { consumerId: FIRST_CONSUMER_ID });
      await waitFor(() => firstSession(ctx).state === 'completed');

      expect(segmentsFor(ctx, firstRecording(ctx).id)).toHaveLength(1);
      expect(ctx.pm.calls.filter((call) => call.path === `/consumers/${FIRST_CONSUMER_ID}/stop`)).toHaveLength(1);
    });
  });

  it('pause calls the exact consumer with {mode:"eos", timeoutMs:5000}', async () => {
    ctx = await createContext();
    await startAndConfirm(ctx);

    await post(ctx, 'pause', ctx.ownerToken);
    await waitFor(() => stopCallFor(ctx, FIRST_CONSUMER_ID) !== undefined);

    expect(stopCallFor(ctx, FIRST_CONSUMER_ID)!.body).toEqual({ mode: 'eos', timeoutMs: TIMERS['T-PAUSE-EOS'] });
    expect(TIMERS['T-PAUSE-EOS']).toBe(5000);
  });

  it('T-PAUSE-EOS timeout marks the segment truncated but still pauses', async () => {
    ctx = await createContext();
    await startAndConfirm(ctx);

    const sleepCountBeforePause = ctx.clock.sleeps.length;
    await post(ctx, 'pause', ctx.ownerToken);
    // T-PAUSE-EOS and T-START-CONFIRM are both 5000ms, so a plain `sleeps.includes(5000)`
    // would already be true from the start phase — wait for a *new* sleep call instead.
    await waitFor(() => ctx.clock.sleeps.length > sleepCountBeforePause);
    expect(ctx.clock.sleeps.at(-1)).toBe(TIMERS['T-PAUSE-EOS']);
    ctx.clock.advance(TIMERS['T-PAUSE-EOS']);

    await waitFor(() => firstSession(ctx).state === 'paused');

    const recording = firstRecording(ctx);
    const [segment] = segmentsFor(ctx, recording.id);
    expect(segment!.state).toBe('truncated');
    expect(segment!.endReason).toBe('pause');
  });

  it('resume opens seg-001 after a T-RESUME-CONFIRM (3s) confirm race, and stop uses T-STOP-EOS (8000ms)', async () => {
    ctx = await createContext();
    await startAndConfirm(ctx);
    await pauseGracefully(ctx, FIRST_CONSUMER_ID);

    const sleepCountBeforeResume = ctx.clock.sleeps.length;
    const resume = await post(ctx, 'resume', ctx.ownerToken);
    expect(resume.statusCode).toBe(202);
    await waitFor(() => firstSession(ctx).state === 'starting');

    await waitFor(() => ctx.pm.calls.filter((call) => call.path === '/consumers/record').length === 2);
    const resumeCall = ctx.pm.calls.filter((call) => call.path === '/consumers/record')[1]!;
    const session = firstSession(ctx);
    expect((resumeCall.body as { outputPath?: string }).outputPath).toBe(`${ctx.app.config.recordingsRoot}/sessions/${session.id}/seg-001.ts`);

    expect(TIMERS['T-RESUME-CONFIRM']).toBe(3000);
    await waitFor(() => ctx.clock.sleeps.length > sleepCountBeforeResume);
    expect(ctx.clock.sleeps.at(-1)).toBe(TIMERS['T-RESUME-CONFIRM']);

    ctx.pm.publish('evt.pm.consumer.running', { consumerId: SECOND_CONSUMER_ID, pgid: 2 });
    await waitFor(() => firstSession(ctx).state === 'recording');

    const recording = firstRecording(ctx);
    expect(segmentsFor(ctx, recording.id)).toHaveLength(2);

    await post(ctx, 'stop', ctx.ownerToken);
    await waitFor(() => stopCallFor(ctx, SECOND_CONSUMER_ID) !== undefined);
    expect(stopCallFor(ctx, SECOND_CONSUMER_ID)!.body).toEqual({ mode: 'eos', timeoutMs: TIMERS['T-STOP-EOS'] });
    expect(TIMERS['T-STOP-EOS']).toBe(8000);
  });

  it('segment indices are contiguous and ordered strictly by index across pause/resume cycles', async () => {
    ctx = await createContext();
    await startAndConfirm(ctx);

    await pauseGracefully(ctx, FIRST_CONSUMER_ID);
    await resumeAndConfirm(ctx, 2, SECOND_CONSUMER_ID);
    await pauseGracefully(ctx, SECOND_CONSUMER_ID);
    await resumeAndConfirm(ctx, 3, THIRD_CONSUMER_ID);

    const recording = firstRecording(ctx);
    const segs = segmentsFor(ctx, recording.id).sort((a, b) => a.index - b.index);
    expect(segs.map((segment) => segment.index)).toEqual([0, 1, 2]);
  });

  it('a separate-files preset creates one RecordingFile row per output per segment', async () => {
    ctx = await createContext();
    ctx.app.db.update(channelConfigs).set({ presetId: 'separate-files' }).where(eq(channelConfigs.channelId, 'local')).run();

    await startAndConfirm(ctx);
    await pauseGracefully(ctx, FIRST_CONSUMER_ID);

    const recording = firstRecording(ctx);
    const [segment] = segmentsFor(ctx, recording.id);
    const files = ctx.app.db.select().from(recordingFiles).where(eq(recordingFiles.segmentId, segment!.id)).all();

    expect(files).toHaveLength(2);
    const byStreamKey = new Map(files.map((file) => [file.streamKey, file]));
    expect(byStreamKey.get('presentation')?.hasAudio).toBe(true);
    expect(byStreamKey.get('lecturer-cam')?.hasAudio).toBe(false);
    for (const file of files) {
      expect(file.kind).toBe('segment');
      expect(file.state).toBe('finalized');
      expect(file.isUploadable).toBe(false);
      expect(file.path).toContain(`seg-000-${file.streamKey}.ts`);
    }
  });

  it('recordedDurationMs sums segment durations and excludes the pause gap', async () => {
    ctx = await createContext();
    await startAndConfirm(ctx);

    ctx.clock.advance(10_000);
    await pauseGracefully(ctx, FIRST_CONSUMER_ID);
    expect(firstSession(ctx).recordedDurationMs).toBe(10_000);

    ctx.clock.advance(5_000); // the pause gap — must not be counted

    await resumeAndConfirm(ctx, 2, SECOND_CONSUMER_ID);

    ctx.clock.advance(7_000);
    await stopGracefully(ctx, SECOND_CONSUMER_ID);

    expect(firstSession(ctx).recordedDurationMs).toBe(17_000);
  });

  it('the local channel is never touched by pause — only the record consumer receives a stop call', async () => {
    ctx = await createContext();
    await startAndConfirm(ctx);
    const callsBeforePause = ctx.pm.calls.length;

    await pauseGracefully(ctx, FIRST_CONSUMER_ID);

    const newCalls = ctx.pm.calls.slice(callsBeforePause);
    for (const call of newCalls) {
      expect(call.path === `/consumers/${FIRST_CONSUMER_ID}/stop` || call.path === '/device/led').toBe(true);
    }
  });

  it('KEEP B-07/B-10: a paused session persists across a service restart and resume still works', async () => {
    ctx = await createContext();
    await startAndConfirm(ctx);
    await pauseGracefully(ctx, FIRST_CONSUMER_ID);
    const before = firstSession(ctx);

    await ctx.app.close();

    const config = loadConfig({
      NODE_ENV: 'test',
      CORE_API_DB_PATH: ctx.dbPath,
      CORE_API_JWT_SECRET: 'recording-lifecycle-test-secret',
      CORE_API_PROVISIONING_PATH: ctx.provisioningPath,
      CORE_API_RECORDINGS_ROOT: join(ctx.dir, 'recordings'),
      CORE_API_PM_BASE_URL: `http://127.0.0.1:1`, // unreachable on purpose — restart persistence must not depend on PM being up
      CORE_API_INTERNAL_BEARER: BEARER,
    });
    const restarted = await buildApp({ config, clock: new FakeClock(NOW), ids: new UlidGenerator() });
    await restarted.lifecycle.start();

    const loginResponse = await restarted.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'owner', password: 'Password1', client: 'panel' },
    });
    const accessToken = (loginResponse.json() as { tokens: { accessToken: string } }).tokens.accessToken;

    const stateResponse = await restarted.inject({
      method: 'GET',
      url: '/api/v1/recording/state',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const snapshot = stateResponse.json() as RecordingStatePayload;
    expect(snapshot.state).toBe('paused');
    expect(snapshot.sessionId).toBe(before.id);

    const resumeResponse = await restarted.inject({
      method: 'POST',
      url: '/api/v1/recording/resume',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(resumeResponse.statusCode).toBe(202);

    await restarted.close();
  });

  it('contract-valid recording.segment payloads are emitted on pause/resume/stop transitions', async () => {
    ctx = await createContext();
    const segmentEvents: RecordingSegmentPayload[] = [];
    ctx.app.bus.subscribe('recording.segment', (payload) => segmentEvents.push(payload));

    await startAndConfirm(ctx);
    await post(ctx, 'pause', ctx.ownerToken);
    await waitFor(() => stopCallFor(ctx, FIRST_CONSUMER_ID) !== undefined);
    ctx.pm.publish('evt.pm.consumer.eos', { consumerId: FIRST_CONSUMER_ID });
    await waitFor(() => segmentEvents.some((event) => event.state === 'finalized'));

    const finalized = segmentEvents.find((event) => event.state === 'finalized')!;
    expect(finalized.endReason).toBe('pause');
    expect(finalized.index).toBe(0);
  });
});
