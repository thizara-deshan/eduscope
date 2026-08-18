import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { RecordingArtifactPayload, RecordingStatePayload } from '@eduscope/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type CoreDatabase } from '../../src/db/client.js';
import { migrate } from '../../src/db/migrate.js';
import { seed } from '../../src/db/seeds.js';
import { lectureSessions, recordingFiles, recordingSegments, recordings, users } from '../../src/db/schema.js';
import type { Cancel } from '../../src/lib/clock.js';
import { DomainBus } from '../../src/lib/domain-bus.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { ArtifactRetryNotAllowedError } from '../../src/modules/library/artifact-machine.js';
import { ArtifactExecutor } from '../../src/modules/library/merge-worker.js';
import { FakeClock } from '../fakes/clock.js';
import { FakeMediaTools } from '../fakes/media-tools.js';

const NOW = new Date('2026-05-01T09:00:00.000Z');

/** Records every `sleep()` duration the executor requests (watchdog/backoff assertions) without slowing the test down. */
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
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: condition not met in time');
    await delay(5);
  }
}

interface Harness {
  dir: string;
  core: CoreDatabase;
  clock: RecordingClock;
  ids: UlidGenerator;
  bus: DomainBus;
  runner: FakeMediaTools;
  executor: ArtifactExecutor;
  artifactEvents: RecordingArtifactPayload[];
  recordingsRoot: string;
  runtimeDir: string;
}

function createHarness(clock: RecordingClock = new RecordingClock(NOW)): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'core-api-artifact-'));
  const core = openDatabase(join(dir, 'core.db'));
  migrate(core);
  const ids = new UlidGenerator();
  seed(core, NOW, ids);
  const bus = new DomainBus();
  const runner = new FakeMediaTools();
  const recordingsRoot = join(dir, 'recordings');
  const runtimeDir = join(dir, 'runtime');

  const artifactEvents: RecordingArtifactPayload[] = [];
  bus.subscribe('recording.artifact', (payload) => artifactEvents.push(payload));

  const executor = new ArtifactExecutor({
    get db() {
      return core.db;
    },
    clock,
    ids,
    bus,
    runner,
    recordingsRoot,
    runtimeDir,
  });

  return { dir, core, clock, ids, bus, runner, executor, artifactEvents, recordingsRoot, runtimeDir };
}

function destroyHarness(h: Harness): void {
  h.core.close();
  rmSync(h.dir, { recursive: true, force: true });
}

interface SeedRecordingOptions {
  sessionId: string;
  recordingId: string;
  recordedDurationMs?: number;
}

function seedUserAndSession(h: Harness, opts: SeedRecordingOptions): void {
  h.core.db
    .insert(users)
    .values({
      id: 'user-1',
      username: 'owner',
      displayName: 'Owner',
      role: 'lecturer',
      source: 'local',
      mustResetPassword: false,
      disabled: false,
      createdAt: NOW.toISOString(),
    })
    .run();
  h.core.db
    .insert(lectureSessions)
    .values({
      id: opts.sessionId,
      title: 'Lecture',
      hallCode: 'HALL-1',
      hallDisplayName: 'Hall 1',
      deviceId: 'device-1',
      ownerUserId: 'user-1',
      startedByActor: 'user',
      state: 'completed',
      startedAt: NOW.toISOString(),
      endedAt: NOW.toISOString(),
      recordedDurationMs: opts.recordedDurationMs ?? 0,
      pauseCount: 0,
      channelActivations: [],
      sourceSnapshot: {},
      aiEnabledAtStart: false,
    })
    .run();
  h.core.db
    .insert(recordings)
    .values({
      id: opts.recordingId,
      sessionId: opts.sessionId,
      ownerUserId: 'user-1',
      state: 'capturing',
      layoutPresetId: 'pc-only',
      segmentCount: 0,
      mergeState: 'pending',
      retentionDeleteAfter: NOW.toISOString(),
      playbackAuthRequired: true,
    })
    .run();
}

interface SegmentFileSpec {
  streamKey: string;
  bytes: number;
  fileState?: 'writing' | 'finalized';
  hasAudio?: boolean;
}

interface SegmentSpec {
  index: number;
  endReason?: 'pause' | 'stop' | 'crash' | 'error' | 'takeover';
  files: SegmentFileSpec[];
}

/** One `recording_segments` row (SEG-1) plus one `recording_files` row per output (SEG-3) — mirrors `closeSegment` in src/modules/recording/segments.ts, where every output for a segment shares the same `segmentId`. Returns the seeded file paths keyed by `streamKey`. */
function seedSegment(h: Harness, recordingId: string, sessionId: string, spec: SegmentSpec): Record<string, string> {
  const segmentId = `seg-${sessionId}-${spec.index}`;
  h.core.db
    .insert(recordingSegments)
    .values({
      id: segmentId,
      recordingId,
      index: spec.index,
      startedAt: NOW.toISOString(),
      endedAt: NOW.toISOString(),
      durationMs: 1000,
      endReason: spec.endReason ?? 'stop',
      state: spec.endReason === 'crash' ? 'truncated' : 'finalized',
    })
    .run();

  const dir = join(h.recordingsRoot, 'sessions', sessionId);
  mkdirSync(dir, { recursive: true });

  const paths: Record<string, string> = {};
  for (const file of spec.files) {
    const path = join(dir, `seg-${String(spec.index).padStart(3, '0')}-${file.streamKey}.ts`);
    writeFileSync(path, Buffer.alloc(file.bytes, 1));
    paths[file.streamKey] = path;

    h.core.db
      .insert(recordingFiles)
      .values({
        id: `${segmentId}-${file.streamKey}`,
        recordingId,
        segmentId,
        kind: 'segment',
        streamKey: file.streamKey,
        path,
        container: 'mpegts',
        state: file.fileState ?? 'finalized',
        hasAudio: file.hasAudio ?? true,
        isUploadable: false,
      })
      .run();
  }

  return paths;
}

function publishCompleted(h: Harness, sessionId: string): void {
  const payload: RecordingStatePayload = {
    state: 'completed',
    startReason: null,
    sessionId,
    title: 'Lecture',
    ownerUserId: 'user-1',
    ownerDisplayName: 'Owner',
    startedAt: NOW.toISOString(),
    recordedDurationMs: 0,
    segmentIndex: null,
    segmentCount: null,
    pauseCount: 0,
    takeoverBy: null,
    takeoverAt: null,
    takeoverByDisplayName: null,
    errorCode: null,
    errorMessage: null,
  };
  h.bus.publish('recording.state', payload);
}

function getRecording(h: Harness, recordingId: string): typeof recordings.$inferSelect {
  return h.core.db.select().from(recordings).where(eq(recordings.id, recordingId)).get()!;
}

function filesFor(h: Harness, recordingId: string): Array<typeof recordingFiles.$inferSelect> {
  return h.core.db.select().from(recordingFiles).where(eq(recordingFiles.recordingId, recordingId)).all();
}

describe('ArtifactExecutor (machine 1b, design/core-api.md §5.1)', () => {
  let h: Harness;

  beforeEach(async () => {
    h = createHarness();
    await h.executor.start();
  });

  afterEach(async () => {
    await h.executor.stop('shutdown');
    destroyHarness(h);
  });

  it('RA-01: a single-segment recording is remuxed directly to mp4, no merged .ts row', async () => {
    const sessionId = 's-1';
    const recordingId = 'r-1';
    seedUserAndSession(h, { sessionId, recordingId });
    seedSegment(h, recordingId, sessionId, { index: 0, files: [{ streamKey: 'main', bytes: 1000 }] });

    publishCompleted(h, sessionId);
    await waitFor(() => getRecording(h, recordingId).state === 'ready');

    const files = filesFor(h, recordingId);
    expect(files.filter((f) => f.kind === 'merged')).toHaveLength(0);
    const derived = files.find((f) => f.kind === 'derived');
    expect(derived).toBeDefined();
    expect(derived?.container).toBe('mp4');
    expect(derived?.state).toBe('finalized');
    expect(derived?.isUploadable).toBe(true);
  });

  it('RA-02: a multi-segment recording concatenates per streamKey then remuxes to mp4', async () => {
    const sessionId = 's-2';
    const recordingId = 'r-2';
    seedUserAndSession(h, { sessionId, recordingId });
    seedSegment(h, recordingId, sessionId, { index: 0, files: [{ streamKey: 'main', bytes: 1000 }] });
    seedSegment(h, recordingId, sessionId, { index: 1, files: [{ streamKey: 'main', bytes: 1000 }] });
    seedSegment(h, recordingId, sessionId, { index: 2, files: [{ streamKey: 'main', bytes: 1000 }] });

    publishCompleted(h, sessionId);
    await waitFor(() => getRecording(h, recordingId).state === 'ready');

    const files = filesFor(h, recordingId);
    const merged = files.find((f) => f.kind === 'merged');
    expect(merged).toBeDefined();
    expect(merged?.container).toBe('mpegts');
    const derived = files.find((f) => f.kind === 'derived');
    expect(derived).toBeDefined();
    expect(derived?.container).toBe('mp4');
  });

  it('separate-files layouts produce independent per-streamKey outputs', async () => {
    const sessionId = 's-3';
    const recordingId = 'r-3';
    seedUserAndSession(h, { sessionId, recordingId });
    seedSegment(h, recordingId, sessionId, {
      index: 0,
      files: [
        { streamKey: 'presentation', bytes: 1000, hasAudio: true },
        { streamKey: 'lecturer-cam', bytes: 500, hasAudio: false },
      ],
    });

    publishCompleted(h, sessionId);
    await waitFor(() => getRecording(h, recordingId).state === 'ready');

    const files = filesFor(h, recordingId);
    const derivedKeys = files.filter((f) => f.kind === 'derived').map((f) => f.streamKey).sort();
    expect(derivedKeys).toEqual(['lecturer-cam', 'presentation']);
  });

  it('truncated/crash segments are included in the merge; zero-byte failed files are excluded but retained', async () => {
    const sessionId = 's-4';
    const recordingId = 'r-4';
    seedUserAndSession(h, { sessionId, recordingId });
    seedSegment(h, recordingId, sessionId, { index: 0, files: [{ streamKey: 'main', bytes: 1000 }] });
    seedSegment(h, recordingId, sessionId, {
      index: 1,
      endReason: 'crash',
      files: [{ streamKey: 'main', bytes: 800, fileState: 'writing' }],
    });
    seedSegment(h, recordingId, sessionId, { index: 2, files: [{ streamKey: 'main', bytes: 0 }] });

    publishCompleted(h, sessionId);
    await waitFor(() => getRecording(h, recordingId).state === 'ready');

    const files = filesFor(h, recordingId);
    const segmentFiles = files.filter((f) => f.kind === 'segment');
    expect(segmentFiles).toHaveLength(3);

    const zeroByteFile = segmentFiles.find((f) => f.path.includes('seg-002'));
    expect(zeroByteFile?.state).toBe('missing');

    const crashedFile = segmentFiles.find((f) => f.path.includes('seg-001'));
    expect(crashedFile?.state).toBe('finalized');

    const derived = files.find((f) => f.kind === 'derived')!;
    // 1000 (seg-000) + 800 (seg-001, crash) bytes merged; the zero-byte seg-002 excluded.
    expect(derived.sizeBytes).toBe(1800);
  });

  it('preserves the raw .ts capture rows unmodified (KEEP B-23 dual artifact)', async () => {
    const sessionId = 's-5';
    const recordingId = 'r-5';
    seedUserAndSession(h, { sessionId, recordingId });
    const paths = seedSegment(h, recordingId, sessionId, { index: 0, files: [{ streamKey: 'main', bytes: 1000 }] });

    publishCompleted(h, sessionId);
    await waitFor(() => getRecording(h, recordingId).state === 'ready');

    const files = filesFor(h, recordingId);
    const segmentFile = files.find((f) => f.kind === 'segment')!;
    expect(segmentFile.path).toBe(paths['main']);
    expect(statSync(paths['main']!).size).toBe(1000);
  });

  it('BR-7: retryMergeRecording skips re-running ffmpeg for an already-checksummed output', async () => {
    const sessionId = 's-6';
    const recordingId = 'r-6';
    seedUserAndSession(h, { sessionId, recordingId });
    seedSegment(h, recordingId, sessionId, { index: 0, files: [{ streamKey: 'main', bytes: 1000 }] });

    publishCompleted(h, sessionId);
    await waitFor(() => getRecording(h, recordingId).state === 'ready');

    const derivedPath = join(h.recordingsRoot, 'sessions', sessionId, 'main.mp4');
    const ffmpegCallsFor = (path: string): number =>
      h.runner.calls.filter((c) => c.executable === 'ffmpeg' && c.args.at(-1) === path).length;
    const callsBefore = ffmpegCallsFor(derivedPath);
    expect(callsBefore).toBe(1);

    h.core.db.update(recordings).set({ state: 'failed', mergeState: 'failed' }).where(eq(recordings.id, recordingId)).run();
    await h.executor.retryMergeRecording(recordingId);

    const callsAfter = ffmpegCallsFor(derivedPath);
    expect(callsAfter).toBe(callsBefore);
    expect(getRecording(h, recordingId).state).toBe('ready');
  });

  it('retryMergeRecording refuses a recording that is not failed', async () => {
    const sessionId = 's-7';
    const recordingId = 'r-7';
    seedUserAndSession(h, { sessionId, recordingId });
    seedSegment(h, recordingId, sessionId, { index: 0, files: [{ streamKey: 'main', bytes: 1000 }] });

    await expect(h.executor.retryMergeRecording(recordingId)).rejects.toBeInstanceOf(ArtifactRetryNotAllowedError);
  });

  it('watchdog: uses max(5 minutes, 3× recordedDurationMs) and aborts a hung ffmpeg', async () => {
    const sessionId = 's-8';
    const recordingId = 'r-8';
    seedUserAndSession(h, { sessionId, recordingId, recordedDurationMs: 200_000 });
    seedSegment(h, recordingId, sessionId, { index: 0, files: [{ streamKey: 'main', bytes: 1000 }] });

    const derivedPath = join(h.recordingsRoot, 'sessions', sessionId, 'main.mp4');
    h.runner.hangFfmpegFor(derivedPath);

    publishCompleted(h, sessionId);
    await waitFor(() => getRecording(h, recordingId).state === 'merging');
    await waitFor(() => h.clock.sleeps.includes(600_000));

    h.clock.advance(600_000);
    await waitFor(() => h.clock.sleeps.includes(30_000));
    expect(getRecording(h, recordingId).state).toBe('merging');
  });

  it('watchdog floor is 5 minutes for a short/zero recordedDurationMs', async () => {
    const sessionId = 's-9';
    const recordingId = 'r-9';
    seedUserAndSession(h, { sessionId, recordingId, recordedDurationMs: 1_000 });
    seedSegment(h, recordingId, sessionId, { index: 0, files: [{ streamKey: 'main', bytes: 1000 }] });

    const derivedPath = join(h.recordingsRoot, 'sessions', sessionId, 'main.mp4');
    h.runner.hangFfmpegFor(derivedPath);

    publishCompleted(h, sessionId);
    await waitFor(() => h.clock.sleeps.includes(300_000));
  });

  it('retries at 30s then 5min, then RA-04 fails after the third attempt with no artifact.ready and inputs retained', async () => {
    const sessionId = 's-10';
    const recordingId = 'r-10';
    seedUserAndSession(h, { sessionId, recordingId });
    seedSegment(h, recordingId, sessionId, { index: 0, files: [{ streamKey: 'main', bytes: 1000 }] });

    const derivedPath = join(h.recordingsRoot, 'sessions', sessionId, 'main.mp4');
    h.runner.failFfmpegFor(derivedPath);

    let readyPublished = false;
    h.bus.subscribe('artifact.ready', () => {
      readyPublished = true;
    });

    publishCompleted(h, sessionId);

    // Each attempt logs a watchdog sleep() plus (until the budget is exhausted) a
    // backoff sleep() — both 5 minutes in this test's default (recordedDurationMs=0
    // floors the watchdog at the same 5-minute value as the second retry delay), so
    // gating on `.length` growth (not the ambiguous shared 300_000 value) is what
    // guarantees each `advance()` below only fires once the next attempt has truly
    // registered its own sleep, not a stale one still sitting in the call log.
    await waitFor(() => h.clock.sleeps.length >= 2); // attempt 0: watchdog + 30s backoff
    h.runner.failFfmpegFor(derivedPath);
    h.clock.advance(30_000);

    await waitFor(() => h.clock.sleeps.length >= 4); // attempt 1: watchdog + 5min backoff
    h.runner.failFfmpegFor(derivedPath);
    h.clock.advance(300_000);

    await waitFor(() => getRecording(h, recordingId).state === 'failed');

    expect(getRecording(h, recordingId).mergeState).toBe('failed');
    expect(readyPublished).toBe(false);
    const files = filesFor(h, recordingId);
    expect(files.filter((f) => f.kind === 'segment')).toHaveLength(1);
    expect(files.some((f) => f.kind === 'derived')).toBe(false);
  });

  it('stop() aborts an in-flight merge without marking the recording failed (recoverable on restart)', async () => {
    const sessionId = 's-11';
    const recordingId = 'r-11';
    seedUserAndSession(h, { sessionId, recordingId });
    seedSegment(h, recordingId, sessionId, { index: 0, files: [{ streamKey: 'main', bytes: 1000 }] });

    const derivedPath = join(h.recordingsRoot, 'sessions', sessionId, 'main.mp4');
    h.runner.hangFfmpegFor(derivedPath);

    publishCompleted(h, sessionId);
    await waitFor(() => getRecording(h, recordingId).state === 'merging');

    await h.executor.stop('shutdown');

    expect(getRecording(h, recordingId).state).toBe('merging');
  });

  it('publishes recording.artifact on every transition', async () => {
    const sessionId = 's-12';
    const recordingId = 'r-12';
    seedUserAndSession(h, { sessionId, recordingId });
    seedSegment(h, recordingId, sessionId, { index: 0, files: [{ streamKey: 'main', bytes: 1000 }] });

    publishCompleted(h, sessionId);
    await waitFor(() => getRecording(h, recordingId).state === 'ready');

    const states = h.artifactEvents.filter((e) => e.recordingId === recordingId).map((e) => e.state);
    expect(states).toEqual(['finalizing', 'merging', 'ready']);
  });
});
