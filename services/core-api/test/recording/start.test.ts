import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { TIMERS, zCommandAccepted, type RecordingSegmentPayload, type RecordingStatePayload } from '@eduscope/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { openDatabase } from '../../src/db/client.js';
import { migrate } from '../../src/db/migrate.js';
import { seed } from '../../src/db/seeds.js';
import { deviceHealth, lectureSessions, recordings, recordingSegments, sourceBindings, storageVolumes, users } from '../../src/db/schema.js';
import { RecordingMachine } from '../../src/modules/recording/machine.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import type { Cancel } from '../../src/lib/clock.js';
import { FakeClock } from '../fakes/clock.js';
import { FakePipelineManager } from '../fakes/pipeline-manager.js';

const NOW = new Date('2026-03-10T08:00:00.000Z');
const BEARER = 'test-pm-bearer-token';
const FIRST_CONSUMER_ID = 'record:00000001';

/**
 * Records every `sleep()` duration requested. The T-START-CONFIRM timer is
 * armed only after the executor's PM response promise resolves — polling
 * `pm.calls` (populated when the *request* merely arrives) races that, so
 * timeout tests wait for the actual `sleep(T-START-CONFIRM, …)` call instead.
 */
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

interface ProvisioningOverrides {
  deviceId?: string;
  hallCode?: string;
  hallDisplayName?: string;
  titlePattern?: string;
}

function writeProvisioning(dir: string, overrides: ProvisioningOverrides = {}): string {
  const path = join(dir, 'provisioning.json');
  writeFileSync(
    path,
    JSON.stringify({
      deviceId: 'device-1',
      hallCode: 'LAC001',
      hallDisplayName: 'Lecture Hall 1',
      titlePattern: '{hall} – {date} {time}',
      ...overrides,
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
  accessToken: string;
  userId: string;
  dbPath: string;
  provisioningPath: string;
}

interface CreateContextOptions {
  provisioning?: ProvisioningOverrides;
  mountVolume?: boolean;
}

async function createUserAndLogin(app: FastifyInstance, ids: UlidGenerator): Promise<{ userId: string; accessToken: string }> {
  const userId = ids.next(NOW);
  app.db
    .insert(users)
    .values({
      id: userId,
      username: 'lecturer1',
      displayName: 'Lecturer One',
      role: 'lecturer',
      source: 'local',
      passwordHash: await hashPassword('Password1'),
      mustResetPassword: false,
      disabled: false,
      createdAt: NOW.toISOString(),
    })
    .run();

  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'lecturer1', password: 'Password1', client: 'panel' },
  });
  const accessToken = (response.json() as { tokens: { accessToken: string } }).tokens.accessToken;
  return { userId, accessToken };
}

async function createContext(options: CreateContextOptions = {}): Promise<TestContext> {
  const dir = mkdtempSync(join(tmpdir(), 'core-api-recording-start-'));
  const pm = new FakePipelineManager({ bearerToken: BEARER });
  const pmBaseUrl = await pm.listen();
  const provisioningPath = writeProvisioning(dir, options.provisioning);
  const dbPath = join(dir, 'core.db');

  const config = loadConfig({
    NODE_ENV: 'test',
    CORE_API_DB_PATH: dbPath,
    CORE_API_JWT_SECRET: 'recording-start-contract-test-secret',
    CORE_API_PROVISIONING_PATH: provisioningPath,
    CORE_API_RECORDINGS_ROOT: join(dir, 'recordings'),
    CORE_API_PM_BASE_URL: pmBaseUrl,
    CORE_API_INTERNAL_BEARER: BEARER,
  });

  const clock = new RecordingClock(NOW);
  const ids = new UlidGenerator();
  const app = await buildApp({ config, clock, ids });
  await app.lifecycle.start();
  await waitFor(() => pm.openConnectionCount === 1); // B-04's bridge must be live before a test publishes a PM event

  const { userId, accessToken } = await createUserAndLogin(app, ids);

  if (options.mountVolume !== false) {
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
  }

  return { dir, app, clock, ids, pm, accessToken, userId, dbPath, provisioningPath };
}

async function destroyContext(ctx: TestContext): Promise<void> {
  await ctx.app.close();
  await ctx.pm.close();
  rmSync(ctx.dir, { recursive: true, force: true });
}

async function startRecording(ctx: TestContext): Promise<{ statusCode: number; body: unknown }> {
  const response = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/recording/start',
    headers: { authorization: `Bearer ${ctx.accessToken}` },
  });
  return { statusCode: response.statusCode, body: response.json() };
}

async function getRecordingState(ctx: TestContext): Promise<RecordingStatePayload> {
  const response = await ctx.app.inject({
    method: 'GET',
    url: '/api/v1/recording/state',
    headers: { authorization: `Bearer ${ctx.accessToken}` },
  });
  return response.json() as RecordingStatePayload;
}

function sessionCount(ctx: TestContext): number {
  return ctx.app.db.select().from(lectureSessions).all().length;
}

describe('POST /recording/start (R-01) and GET /recording/state', () => {
  let ctx: TestContext;

  afterEach(async () => {
    await destroyContext(ctx);
  });

  describe('Class A guards create no session', () => {
    it('recorder.busy: refuses when another session is already active, names the owner', async () => {
      ctx = await createContext();
      ctx.app.db
        .insert(lectureSessions)
        .values({
          id: 'existing-session',
          title: 'Existing lecture',
          hallCode: 'LAC001',
          hallDisplayName: 'Lecture Hall 1',
          deviceId: 'device-1',
          ownerUserId: ctx.userId,
          startedByActor: 'user',
          state: 'recording',
          startedAt: NOW.toISOString(),
          pauseCount: 0,
          channelActivations: [],
          sourceSnapshot: {},
          aiEnabledAtStart: false,
        })
        .run();

      const { statusCode, body } = await startRecording(ctx);

      expect(statusCode).toBe(409);
      expect((body as { code: string }).code).toBe('recorder.busy');
      expect((body as { meta?: { title?: string } }).meta?.title).toBe('Existing lecture');
      expect(sessionCount(ctx)).toBe(1); // no phantom second row
    });

    it('provisioning.incomplete: refuses when hallCode is empty', async () => {
      ctx = await createContext({ provisioning: { hallCode: '' } });

      const { statusCode, body } = await startRecording(ctx);

      expect(statusCode).toBe(422);
      expect((body as { code: string }).code).toBe('provisioning.incomplete');
      expect(sessionCount(ctx)).toBe(0);
    });

    it('volume.unavailable: refuses when no recordings volume is mounted', async () => {
      ctx = await createContext({ mountVolume: false });

      const { statusCode, body } = await startRecording(ctx);

      expect(statusCode).toBe(422);
      expect((body as { code: string }).code).toBe('volume.unavailable');
      expect(sessionCount(ctx)).toBe(0);
    });

    it('storage.critical: refuses when device_health reports critical pressure', async () => {
      ctx = await createContext();
      const criticalHealth = {
        id: 'device-health' as const,
        deviceId: 'device-1',
        observedAt: NOW.toISOString(),
        storageTotalBytes: 1_000_000_000_000,
        storageFreeBytes: 1_000_000_000,
        storagePressure: 'critical' as const,
        diskHealth: 'good' as const,
        captureCardState: 'present' as const,
        publisherStates: {},
        ntpSynced: true,
        lastBootAt: NOW.toISOString(),
      };
      // B-21's HealthAggregator already seeds this singleton row at app startup — upsert rather than insert.
      ctx.app.db.insert(deviceHealth).values(criticalHealth).onConflictDoUpdate({ target: deviceHealth.id, set: criticalHealth }).run();

      const { statusCode, body } = await startRecording(ctx);

      expect(statusCode).toBe(422);
      expect((body as { code: string }).code).toBe('storage.critical');
      expect(sessionCount(ctx)).toBe(0);
    });

    it('config.invalid: a required unplugged source (presentation unbound) never creates a phantom row', async () => {
      ctx = await createContext();
      ctx.app.db.update(sourceBindings).set({ physicalInputId: null, enabled: false }).where(eq(sourceBindings.roleId, 'presentation')).run();

      const { statusCode, body } = await startRecording(ctx);

      expect(statusCode).toBe(422);
      expect((body as { code: string; meta?: { roleId?: string } }).code).toBe('config.invalid');
      expect((body as { meta?: { roleId?: string } }).meta?.roleId).toBe('presentation');
      expect(sessionCount(ctx)).toBe(0);
    });
  });

  it('202 matches zCommandAccepted and resolveBySec is T-CMD-RESOLVE (10s)', async () => {
    ctx = await createContext();

    const { statusCode, body } = await startRecording(ctx);

    expect(statusCode).toBe(202);
    expect(() => zCommandAccepted.parse(body)).not.toThrow();
    expect((body as { resolveBySec: number }).resolveBySec).toBe(10);
  });

  it('creates LectureSession(starting) + Recording(capturing) in one transaction; title uses the provisioning pattern; source/channel snapshot is captured immutably', async () => {
    ctx = await createContext();

    await startRecording(ctx);

    const session = ctx.app.db.select().from(lectureSessions).all()[0]!;
    const recording = ctx.app.db.select().from(recordings).all()[0]!;

    expect(session.state).toBe('starting');
    expect(session.title).toBe(`Lecture Hall 1 – 2026-03-10 08:00`);
    expect(session.hallCode).toBe('LAC001');
    expect(session.deviceId).toBe('device-1');
    expect(session.ownerUserId).toBe(ctx.userId);
    expect(session.sourceSnapshot.presentation).toEqual({ inputId: expect.any(String), address: '/dev/video0' });
    expect(session.sourceSnapshot['mic-room']).toEqual({ inputId: null, address: null });

    expect(recording.sessionId).toBe(session.id);
    expect(recording.state).toBe('capturing');
    expect(recording.layoutPresetId).toBe('fifty-fifty');
    expect(recording.segmentCount).toBe(0);

    // INV-SB-2: the snapshot is immutable — a later binding change must not rewrite history.
    ctx.app.db.update(sourceBindings).set({ enabled: false }).where(eq(sourceBindings.roleId, 'presentation')).run();
    const reloaded = ctx.app.db.select().from(lectureSessions).where(eq(lectureSessions.id, session.id)).get()!;
    expect(reloaded.sourceSnapshot.presentation!.inputId).not.toBeNull();
  });

  it('pushes a deterministic segment-0 output path to pipeline-manager', async () => {
    ctx = await createContext();

    await startRecording(ctx);
    await waitFor(() => ctx.pm.calls.some((call) => call.path === '/consumers/record'));

    const session = ctx.app.db.select().from(lectureSessions).all()[0]!;
    const call = ctx.pm.calls.find((c) => c.path === '/consumers/record')!;
    const body = call.body as { preset: string; ratioA?: number; ratioB?: number; outputPath?: string };

    expect(body.preset).toBe('fifty-fifty');
    expect(body.ratioA).toBe(50);
    expect(body.ratioB).toBe(50);
    expect(body.outputPath).toBe(`${ctx.app.config.recordingsRoot}/sessions/${session.id}/seg-000.ts`);
  });

  it('state remains starting until pipeline-manager confirms', async () => {
    ctx = await createContext();

    await startRecording(ctx);
    await waitFor(() => ctx.pm.calls.some((call) => call.path === '/consumers/record'));

    const snapshot = await getRecordingState(ctx);
    expect(snapshot.state).toBe('starting');
    expect(snapshot.startReason).toBeNull(); // startReason is only carried on the WS transition event, not the REST snapshot
  });

  it('confirm (R-05) opens segment 0 and emits contract-valid recording.state + recording.segment', async () => {
    ctx = await createContext();
    const stateEvents: RecordingStatePayload[] = [];
    const segmentEvents: RecordingSegmentPayload[] = [];
    ctx.app.bus.subscribe('recording.state', (payload) => stateEvents.push(payload));
    ctx.app.bus.subscribe('recording.segment', (payload) => segmentEvents.push(payload));

    await startRecording(ctx);
    await waitFor(() => ctx.pm.calls.some((call) => call.path === '/consumers/record'));

    ctx.pm.publish('evt.pm.consumer.running', { consumerId: FIRST_CONSUMER_ID, pgid: 4321 });

    await waitFor(() => stateEvents.some((event) => event.state === 'recording'));

    const session = ctx.app.db.select().from(lectureSessions).all()[0]!;
    expect(session.state).toBe('recording');

    const segments = ctx.app.db.select().from(recordingSegments).all();
    expect(segments).toHaveLength(1);
    expect(segments[0]!.index).toBe(0);
    expect(segments[0]!.state).toBe('capturing');
    expect(segments[0]!.endReason).toBeNull();

    const recording = ctx.app.db.select().from(recordings).all()[0]!;
    expect(recording.segmentCount).toBe(1);

    const confirmedState = stateEvents.find((event) => event.state === 'recording')!;
    expect(confirmedState.segmentIndex).toBe(0);
    expect(confirmedState.segmentCount).toBe(1);

    expect(segmentEvents).toHaveLength(1);
    expect(segmentEvents[0]!.state).toBe('capturing');
    expect(segmentEvents[0]!.endReason).toBeNull();
    expect(segmentEvents[0]!.index).toBe(0);

    await waitFor(() => ctx.pm.calls.some((call) => call.path === '/device/led' && (call.body as { mode?: string }).mode === 'blink'));
  });

  describe('R-06/R-07 launch-failure classification', () => {
    it('R-06: T-START-CONFIRM timeout with no segments transitions to error', async () => {
      ctx = await createContext();

      await startRecording(ctx);
      // The T-START-CONFIRM timer is armed only after the PM response promise
      // resolves — wait for the real sleep() call, not just the request arriving.
      await waitFor(() => ctx.clock.sleeps.includes(TIMERS['T-START-CONFIRM']));

      ctx.clock.advance(TIMERS['T-START-CONFIRM']);

      await waitFor(() => {
        const session = ctx.app.db.select().from(lectureSessions).all()[0]!;
        return session.state === 'error';
      });

      const session = ctx.app.db.select().from(lectureSessions).all()[0]!;
      expect(session.errorCode).toBe('confirm_timeout');
      expect(session.errorMessage).toBeTruthy();
      expect(session.endedAt).not.toBeNull();
      expect(ctx.app.db.select().from(recordingSegments).all()).toHaveLength(0);
    });

    it('R-06: a synchronous pipeline-manager rejection (no segments) transitions to error', async () => {
      ctx = await createContext();
      ctx.pm.queueRecordResponse({ status: 409, body: { code: 'publisher_not_running', title: 'Required publisher is not running', status: 409 } });

      const { statusCode } = await startRecording(ctx);
      expect(statusCode).toBe(202); // acceptance is unaffected — the failure resolves only via the event channel

      await waitFor(() => {
        const session = ctx.app.db.select().from(lectureSessions).all()[0]!;
        return session.state === 'error';
      });

      const session = ctx.app.db.select().from(lectureSessions).all()[0]!;
      expect(session.errorCode).toBe('publisher_not_running');
    });

    it('R-06: evt.pm.consumer.failed with no segments transitions to error', async () => {
      ctx = await createContext();

      await startRecording(ctx);
      await waitFor(() => ctx.pm.calls.some((call) => call.path === '/consumers/record'));

      ctx.pm.publish('evt.pm.consumer.failed', { consumerId: FIRST_CONSUMER_ID, code: 'spawn_failed' });

      await waitFor(() => {
        const session = ctx.app.db.select().from(lectureSessions).all()[0]!;
        return session.state === 'error';
      });

      const session = ctx.app.db.select().from(lectureSessions).all()[0]!;
      expect(session.errorCode).toBe('spawn_failed');
    });

    it("R-07 (unit level — a resume-failure segments-exist path B-05's own start flow never reaches): failStart preserves the lecture (stopping, no errorCode) when a segment already exists", () => {
      const dir = mkdtempSync(join(tmpdir(), 'core-api-recording-machine-'));
      try {
        const core = openDatabase(join(dir, 'core.db'));
        migrate(core);
        const clock = new FakeClock(NOW);
        const ids = new UlidGenerator();
        seed(core, NOW, ids);

        const ownerId = ids.next(NOW);
        core.db
          .insert(users)
          .values({
            id: ownerId,
            username: 'lecturer2',
            displayName: 'Lecturer Two',
            role: 'lecturer',
            source: 'local',
            mustResetPassword: false,
            disabled: false,
            createdAt: NOW.toISOString(),
          })
          .run();

        const sessionId = ids.next(NOW);
        const recordingId = ids.next(NOW);
        core.db
          .insert(lectureSessions)
          .values({
            id: sessionId,
            title: 'Resume test',
            hallCode: 'LAC001',
            hallDisplayName: 'Lecture Hall 1',
            deviceId: 'device-1',
            ownerUserId: ownerId,
            startedByActor: 'user',
            state: 'starting',
            startedAt: NOW.toISOString(),
            pauseCount: 0,
            channelActivations: [],
            sourceSnapshot: {},
            aiEnabledAtStart: false,
          })
          .run();
        core.db
          .insert(recordings)
          .values({
            id: recordingId,
            sessionId,
            ownerUserId: ownerId,
            state: 'capturing',
            layoutPresetId: 'fifty-fifty',
            segmentCount: 1,
            mergeState: 'pending',
            retentionDeleteAfter: NOW.toISOString(),
            playbackAuthRequired: true,
          })
          .run();
        core.db
          .insert(recordingSegments)
          .values({
            id: ids.next(NOW),
            recordingId,
            index: 0,
            startedAt: NOW.toISOString(),
            state: 'capturing',
          })
          .run();

        const machine = new RecordingMachine({ db: core.db, clock, ids });
        const result = machine.failStart(sessionId, 'confirm_timeout', 'resume did not confirm in time');

        expect(result.segmentsExist).toBe(true);
        expect(result.session.state).toBe('stopping');
        expect(result.session.errorCode).toBeNull();
        expect(result.session.errorMessage).toBeNull();

        core.close();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  it('KEEP B-03: a recording session persists across a service restart', async () => {
    ctx = await createContext();

    await startRecording(ctx);
    await waitFor(() => ctx.pm.calls.some((call) => call.path === '/consumers/record'));
    ctx.pm.publish('evt.pm.consumer.running', { consumerId: FIRST_CONSUMER_ID, pgid: 1 });
    await waitFor(() => {
      const session = ctx.app.db.select().from(lectureSessions).all()[0]!;
      return session.state === 'recording';
    });
    const before = ctx.app.db.select().from(lectureSessions).all()[0]!;

    await ctx.app.close();

    const config = loadConfig({
      NODE_ENV: 'test',
      CORE_API_DB_PATH: ctx.dbPath,
      CORE_API_JWT_SECRET: 'recording-start-contract-test-secret',
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
      payload: { username: 'lecturer1', password: 'Password1', client: 'panel' },
    });
    const accessToken = (loginResponse.json() as { tokens: { accessToken: string } }).tokens.accessToken;

    const stateResponse = await restarted.inject({
      method: 'GET',
      url: '/api/v1/recording/state',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const snapshot = stateResponse.json() as RecordingStatePayload;

    expect(snapshot.state).toBe('recording');
    expect(snapshot.sessionId).toBe(before.id);
    expect(snapshot.title).toBe(before.title);

    await restarted.close();
  });
});
