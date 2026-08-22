import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TIMERS } from '@eduscope/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type CoreDatabase } from '../../src/db/client.js';
import { migrate } from '../../src/db/migrate.js';
import { seed } from '../../src/db/seeds.js';
import { deviceHealth, lectureSessions, recordingSegments, recordings, users } from '../../src/db/schema.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { runBootRecovery, type BootRecoveryAction } from '../../src/modules/recording/boot-recovery.js';
import type { PmStatus } from '../../src/modules/recording/pm/types.js';
import { FakeClock } from '../fakes/clock.js';

const NOW = new Date('2026-05-01T10:00:00.000Z');

function pmStatus(overrides: Partial<PmStatus> = {}): PmStatus {
  return {
    platform: 'rk3588',
    encodeLedger: { capacity: 3, inUse: 0, reservedBy: [] },
    publishers: {
      usb: { state: 'online', bound: true, fps: 30, rms: null, lastError: null },
      rtsp: { state: 'online', bound: true, fps: 30, rms: null, lastError: null },
      rtsp2: { state: 'online', bound: true, fps: 30, rms: null, lastError: null },
      audio: { state: 'online', bound: true, fps: null, rms: 0.1, lastError: null },
    },
    consumers: [],
    device: { captureCardState: 'present', led: 'off' },
    sequence: 0,
    ...overrides,
  };
}

interface Harness {
  dir: string;
  core: CoreDatabase;
  clock: FakeClock;
  ids: UlidGenerator;
  provisioningPath: string;
  recordingsRoot: string;
  ownerId: string;
}

function createHarness(): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'core-api-boot-recovery-'));
  const core = openDatabase(join(dir, 'core.db'));
  migrate(core);
  const clock = new FakeClock(NOW);
  const ids = new UlidGenerator();
  seed(core, NOW, ids);

  const provisioningPath = join(dir, 'provisioning.json');
  writeFileSync(
    provisioningPath,
    JSON.stringify({ deviceId: 'device-1', hallCode: 'LAC001', hallDisplayName: 'Lecture Hall 1', titlePattern: '{hall}' }),
  );

  const ownerId = ids.next(NOW);
  core.db
    .insert(users)
    .values({
      id: ownerId,
      username: 'owner',
      displayName: 'Owner',
      role: 'lecturer',
      source: 'local',
      mustResetPassword: false,
      disabled: false,
      createdAt: NOW.toISOString(),
    })
    .run();

  return { dir, core, clock, ids, provisioningPath, recordingsRoot: join(dir, 'recordings'), ownerId };
}

function destroyHarness(h: Harness): void {
  h.core.close();
  rmSync(h.dir, { recursive: true, force: true });
}

interface SeedSessionOptions {
  state: 'starting' | 'recording' | 'paused' | 'stopping' | 'finalizing';
  lastHeartbeatAt?: string | null;
  startedAt?: string;
  withOpenSegment?: boolean;
  /** `one_active_session` is a per-device partial unique index (INV-LS-1) — BR-9's "two non-terminal sessions" defensive case can only be constructed in a test by using distinct device ids, since a real single-device DB can never violate its own index this way. */
  deviceId?: string;
}

function seedSession(h: Harness, options: SeedSessionOptions): { sessionId: string; recordingId: string } {
  const sessionId = h.ids.next(h.clock.now());
  const recordingId = h.ids.next(h.clock.now());
  const startedAt = options.startedAt ?? h.clock.now().toISOString();

  h.core.db
    .insert(lectureSessions)
    .values({
      id: sessionId,
      title: 'Test lecture',
      hallCode: 'LAC001',
      hallDisplayName: 'Lecture Hall 1',
      deviceId: options.deviceId ?? 'device-1',
      ownerUserId: h.ownerId,
      startedByActor: 'user',
      state: options.state,
      startedAt,
      lastHeartbeatAt: options.lastHeartbeatAt ?? null,
      pauseCount: 0,
      channelActivations: [],
      sourceSnapshot: {},
      aiEnabledAtStart: false,
    })
    .run();

  h.core.db
    .insert(recordings)
    .values({
      id: recordingId,
      sessionId,
      ownerUserId: h.ownerId,
      state: 'capturing',
      layoutPresetId: 'fifty-fifty',
      segmentCount: options.withOpenSegment ? 1 : 0,
      mergeState: 'pending',
      retentionDeleteAfter: startedAt,
      playbackAuthRequired: true,
    })
    .run();

  if (options.withOpenSegment) {
    h.core.db
      .insert(recordingSegments)
      .values({ id: h.ids.next(h.clock.now()), recordingId, index: 0, startedAt, state: 'capturing' })
      .run();
  }

  return { sessionId, recordingId };
}

function sessionRow(h: Harness, sessionId: string): typeof lectureSessions.$inferSelect {
  return h.core.db.select().from(lectureSessions).where(eq(lectureSessions.id, sessionId)).get()!;
}

function segmentsFor(h: Harness, recordingId: string): (typeof recordingSegments.$inferSelect)[] {
  return h.core.db.select().from(recordingSegments).where(eq(recordingSegments.recordingId, recordingId)).all();
}

function recover(h: Harness, status: PmStatus): BootRecoveryAction[] {
  return runBootRecovery(
    { db: h.core.db, clock: h.clock, ids: h.ids, recordingsRoot: h.recordingsRoot, provisioningPath: h.provisioningPath },
    status,
  );
}

describe('runBootRecovery (BR-1..BR-9, state-machines.md §1.4)', () => {
  let h: Harness;

  afterEach(() => {
    destroyHarness(h);
  });

  it('no non-terminal session: no-op', () => {
    h = createHarness();

    expect(recover(h, pmStatus())).toEqual([{ kind: 'none' }]);
  });

  it('BR-1: recording + a live record consumer -> adopt, no new segment, state stays recording', () => {
    h = createHarness();
    const { sessionId, recordingId } = seedSession(h, { state: 'recording', withOpenSegment: true });

    const actions = recover(h, pmStatus({ consumers: [{ id: 'record:00000001', state: 'running', pgid: 123 }] }));

    expect(actions).toEqual([{ kind: 'adopted', sessionId, consumerId: 'record:00000001' }]);
    const session = sessionRow(h, sessionId);
    expect(session.state).toBe('recording');
    expect(session.recoveredAt).toBeNull();
    const segments = segmentsFor(h, recordingId);
    expect(segments).toHaveLength(1);
    expect(segments[0]!.state).toBe('capturing'); // untouched — no data loss
  });

  it('BR-2: recording + no live consumer + within the recovery window + provisioned -> auto-resume, crashed segment truncated', () => {
    h = createHarness();
    const { sessionId, recordingId } = seedSession(h, {
      state: 'recording',
      withOpenSegment: true,
      lastHeartbeatAt: new Date(NOW.getTime() - 60_000).toISOString(),
    });

    const actions = recover(h, pmStatus());

    expect(actions).toEqual([{ kind: 'auto-resume', sessionId, recordingId }]);
    const session = sessionRow(h, sessionId);
    expect(session.state).toBe('starting');
    expect(session.recoveryOutcome).toBe('auto-resumed');
    expect(session.recoveredAt).toBe(NOW.toISOString());
    const segments = segmentsFor(h, recordingId);
    expect(segments[0]!.state).toBe('truncated');
    expect(segments[0]!.endReason).toBe('crash');
  });

  it('BR-3: recording + no live consumer + outside the recovery window -> finalize (segments exist -> completed)', () => {
    h = createHarness();
    const { sessionId } = seedSession(h, {
      state: 'recording',
      withOpenSegment: true,
      lastHeartbeatAt: new Date(NOW.getTime() - TIMERS['T-RECOVERY-WINDOW'] - 1000).toISOString(),
    });

    const actions = recover(h, pmStatus());

    expect(actions).toEqual([{ kind: 'finalized', sessionId }]);
    const session = sessionRow(h, sessionId);
    expect(session.state).toBe('completed');
    expect(session.recoveryOutcome).toBe('finalized');
  });

  it('BR-4: paused + within the recovery window -> stays paused, no segment touched', () => {
    h = createHarness();
    const { sessionId, recordingId } = seedSession(h, {
      state: 'paused',
      lastHeartbeatAt: new Date(NOW.getTime() - 60_000).toISOString(),
    });

    const actions = recover(h, pmStatus());

    expect(actions).toEqual([{ kind: 'stayed-paused', sessionId }]);
    const session = sessionRow(h, sessionId);
    expect(session.state).toBe('paused');
    expect(session.recoveredAt).toBe(NOW.toISOString());
    expect(session.recoveryOutcome).toBeNull();
    expect(segmentsFor(h, recordingId)).toHaveLength(0);
  });

  it('BR-5: paused + outside the recovery window -> finalize', () => {
    h = createHarness();
    const { sessionId } = seedSession(h, {
      state: 'paused',
      withOpenSegment: true,
      lastHeartbeatAt: new Date(NOW.getTime() - TIMERS['T-RECOVERY-WINDOW'] - 1000).toISOString(),
    });

    const actions = recover(h, pmStatus());

    expect(actions).toEqual([{ kind: 'finalized', sessionId }]);
    expect(sessionRow(h, sessionId).state).toBe('completed');
  });

  it('BR-6: starting (no segments) -> finalize honestly (error, capture.empty)', () => {
    h = createHarness();
    const { sessionId } = seedSession(h, { state: 'starting' });

    const actions = recover(h, pmStatus());

    expect(actions).toEqual([{ kind: 'finalized', sessionId }]);
    const session = sessionRow(h, sessionId);
    expect(session.state).toBe('error');
    expect(session.errorCode).toBe('capture.empty');
  });

  it('BR-6: stopping with a crashed open segment -> finalize (completed), segment closed as crash/truncated', () => {
    h = createHarness();
    const { sessionId, recordingId } = seedSession(h, { state: 'stopping', withOpenSegment: true });

    const actions = recover(h, pmStatus());

    expect(actions).toEqual([{ kind: 'finalized', sessionId }]);
    expect(sessionRow(h, sessionId).state).toBe('completed');
    const segments = segmentsFor(h, recordingId);
    expect(segments[0]!.state).toBe('truncated');
    expect(segments[0]!.endReason).toBe('crash');
  });

  it('BR-7: finalizing -> completed (idempotent re-entry)', () => {
    h = createHarness();
    const { sessionId, recordingId } = seedSession(h, { state: 'finalizing' });
    // A `finalizing` session never has an open segment (R-12/R-13 already closed it) — give it an already-closed one so segmentsExist is true.
    h.core.db
      .insert(recordingSegments)
      .values({
        id: h.ids.next(h.clock.now()),
        recordingId,
        index: 0,
        startedAt: NOW.toISOString(),
        endedAt: NOW.toISOString(),
        durationMs: 1000,
        endReason: 'stop',
        state: 'finalized',
      })
      .run();

    const actions = recover(h, pmStatus());

    expect(actions).toEqual([{ kind: 'finalized', sessionId }]);
    expect(sessionRow(h, sessionId).state).toBe('completed');
  });

  it('BR-8: recording + critical storage -> finalize, never auto-resume even within the recovery window', () => {
    h = createHarness();
    const { sessionId } = seedSession(h, {
      state: 'recording',
      withOpenSegment: true,
      lastHeartbeatAt: new Date(NOW.getTime() - 60_000).toISOString(),
    });
    h.core.db
      .insert(deviceHealth)
      .values({
        id: 'device-health',
        deviceId: 'device-1',
        observedAt: NOW.toISOString(),
        storageTotalBytes: 1_000_000_000,
        storageFreeBytes: 1_000_000,
        storagePressure: 'critical',
        diskHealth: 'good',
        captureCardState: 'present',
        publisherStates: {},
        ntpSynced: true,
        lastBootAt: NOW.toISOString(),
      })
      .run();

    const actions = recover(h, pmStatus());

    expect(actions).toEqual([{ kind: 'finalized', sessionId }]);
    expect(sessionRow(h, sessionId).state).toBe('completed');
  });

  it('BR-9: two non-terminal sessions -> the older is finalized defensively, the newer follows its own row', () => {
    h = createHarness();
    const older = seedSession(h, {
      state: 'recording',
      withOpenSegment: true,
      startedAt: new Date(NOW.getTime() - 120_000).toISOString(),
      deviceId: 'device-1',
    });
    const newer = seedSession(h, {
      state: 'recording',
      withOpenSegment: true,
      startedAt: NOW.toISOString(),
      lastHeartbeatAt: new Date(NOW.getTime() - 60_000).toISOString(),
      deviceId: 'device-2',
    });

    const actions = recover(h, pmStatus());

    expect(actions).toContainEqual({ kind: 'finalized', sessionId: older.sessionId });
    expect(actions).toContainEqual({ kind: 'auto-resume', sessionId: newer.sessionId, recordingId: newer.recordingId });
    expect(sessionRow(h, older.sessionId).state).toBe('completed');
    expect(sessionRow(h, newer.sessionId).state).toBe('starting');
  });
});
