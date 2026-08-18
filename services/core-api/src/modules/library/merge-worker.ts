import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import type { RecordingArtifactPayload } from '@eduscope/shared';
import type { DrizzleDb } from '../../db/client.js';
import { lectureSessions, recordingFiles, recordingSegments, recordings } from '../../db/schema.js';
import type { ArgvRunner } from '../../lib/argv-worker.js';
import type { Clock } from '../../lib/clock.js';
import type { DomainBus, Unsubscribe } from '../../lib/domain-bus.js';
import type { IdGenerator } from '../../lib/ids.js';
import { SerialExecutor } from '../../lib/serial-executor.js';
import type { LifecycleComponent, LifecycleStopReason } from '../../lifecycle.js';
import { ArtifactMachine } from './artifact-machine.js';

/** §9 has no `T-MERGE-*` entry (not a fixed-duration timer — the watchdog scales with `recordedDurationMs`); design/core-api.md §5.1 names it, B-13 owns the literal values. */
const MERGE_WATCHDOG_FLOOR_MS = 5 * 60_000;
const MERGE_WATCHDOG_DURATION_MULTIPLIER = 3;
const MERGE_RETRY_DELAYS_MS = [30_000, 5 * 60_000];

export interface ArtifactExecutorLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

export interface ArtifactExecutorDeps {
  db: DrizzleDb;
  clock: Clock;
  ids: IdGenerator;
  bus: DomainBus;
  runner: ArgvRunner;
  recordingsRoot: string;
  runtimeDir: string;
  logger?: ArtifactExecutorLogger;
}

interface ProbeOutcome {
  sizeBytes: number;
  durationMs: number;
  playable: boolean;
}

interface StreamKeyOutcome {
  sizeBytes: number;
  durationMs: number;
}

type MergeAttemptResult = { ok: true; totalBytes: number; durationMs: number } | { ok: false; stopping: boolean };
type PipelineOutcome =
  | { kind: 'ready'; totalBytes: number; durationMs: number }
  | { kind: 'failed' }
  | { kind: 'aborted' };

type RecordingRow = typeof recordings.$inferSelect;

function toArtifactPayload(recording: RecordingRow): RecordingArtifactPayload {
  return {
    recordingId: recording.id,
    sessionId: recording.sessionId,
    state: recording.state,
    mergeState: recording.mergeState,
    durationMs: recording.durationMs ?? null,
    totalBytes: recording.totalBytes ?? null,
    deleteReason: recording.deleteReason ?? null,
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function checksumOf(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * Machine 1b (design/core-api.md §5.1, RA-01..RA-07). Entered from B-06's
 * finalized-recording transition (`recording.state` with `state:'completed'`);
 * probes every segment, merges/remuxes per `streamKey` through a supervised
 * argv worker (never on the event loop — B-23), and publishes `artifact.ready`
 * exactly once per recording so B-17 can create its upload job.
 */
export class ArtifactExecutor implements LifecycleComponent {
  readonly name = 'artifact-executor';

  readonly #deps: ArtifactExecutorDeps;
  readonly #machine: ArtifactMachine;
  readonly #serial = new SerialExecutor();
  readonly #abortControllers = new Map<string, AbortController>();

  #unsubscribe: Unsubscribe | null = null;
  #stopping = false;

  constructor(deps: ArtifactExecutorDeps) {
    this.#deps = deps;
    this.#machine = new ArtifactMachine({
      get db(): DrizzleDb {
        return deps.db;
      },
      clock: deps.clock,
      ids: deps.ids,
    });
  }

  async start(): Promise<void> {
    this.#unsubscribe = this.#deps.bus.subscribe('recording.state', (payload) => {
      if (payload.state !== 'completed' || payload.sessionId === null) return;
      const sessionId = payload.sessionId;
      void this.#serial.run(() => this.#processBySessionId(sessionId)).catch((error: unknown) => {
        this.#deps.logger?.warn('artifact executor: processing failed unexpectedly', { error: describeError(error), sessionId });
      });
    });
  }

  /** Stops accepting new domain events and aborts any in-flight argv work; durable state is left exactly where it was persisted (`finalizing`/`merging`), never force-marked `failed`, so a later `retryMergeRecording` or the next `recording.state` event can pick it back up. */
  async stop(_reason: LifecycleStopReason): Promise<void> {
    this.#stopping = true;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    for (const controller of this.#abortControllers.values()) {
      controller.abort();
    }
  }

  /** RA-07 — B-14's manual retry surface. Rejects with `ArtifactRetryNotAllowedError` unless the recording is `failed`. */
  async retryMergeRecording(recordingId: string): Promise<void> {
    return this.#serial.run(async () => {
      const recording = this.#machine.resetForRetry(recordingId);
      this.#deps.bus.publish('recording.artifact', toArtifactPayload(recording));
      await this.#runPipeline(recordingId);
    });
  }

  #processBySessionId(sessionId: string): Promise<void> {
    const recording = this.#deps.db.select().from(recordings).where(eq(recordings.sessionId, sessionId)).get();
    if (!recording) return Promise.resolve();
    return this.#runPipeline(recording.id);
  }

  async #runPipeline(recordingId: string): Promise<void> {
    let recording = this.#machine.enterFinalizing(recordingId);
    if (recording.state !== 'finalizing') return;
    this.#deps.bus.publish('recording.artifact', toArtifactPayload(recording));

    const segmentFiles = this.#deps.db
      .select()
      .from(recordingFiles)
      .where(and(eq(recordingFiles.recordingId, recordingId), eq(recordingFiles.kind, 'segment')))
      .all();

    const probeResults = [];
    for (const file of segmentFiles) {
      if (file.state === 'finalized' && file.sizeBytes !== null) continue;
      const probe = await this.#probe(file.path);
      probeResults.push({ fileId: file.id, ...probe });
    }
    this.#machine.applyProbeResults(probeResults);

    recording = this.#machine.enterMerging(recordingId);
    this.#deps.bus.publish('recording.artifact', toArtifactPayload(recording));

    const session = this.#deps.db.select().from(lectureSessions).where(eq(lectureSessions.id, recording.sessionId)).get();
    const recordedDurationMs = session?.recordedDurationMs ?? 0;
    const watchdogMs = Math.max(MERGE_WATCHDOG_FLOOR_MS, MERGE_WATCHDOG_DURATION_MULTIPLIER * recordedDurationMs);

    const outcome = await this.#runWithRetries(recording, watchdogMs);

    if (outcome.kind === 'aborted') return;

    if (outcome.kind === 'ready') {
      recording = this.#machine.markReady(recordingId, outcome.totalBytes, outcome.durationMs);
      this.#deps.bus.publish('recording.artifact', toArtifactPayload(recording));
      this.#deps.bus.publish('artifact.ready', { recordingId, sessionId: recording.sessionId });
    } else {
      recording = this.#machine.markFailed(recordingId);
      this.#deps.bus.publish('recording.artifact', toArtifactPayload(recording));
    }
  }

  async #runWithRetries(recording: RecordingRow, watchdogMs: number): Promise<PipelineOutcome> {
    for (let attempt = 0; ; attempt += 1) {
      const result = await this.#attemptMerge(recording, watchdogMs);
      if (result.ok) return { kind: 'ready', totalBytes: result.totalBytes, durationMs: result.durationMs };
      if (result.stopping) return { kind: 'aborted' };
      if (attempt >= MERGE_RETRY_DELAYS_MS.length) return { kind: 'failed' };
      await this.#deps.clock.sleep(MERGE_RETRY_DELAYS_MS[attempt]!);
    }
  }

  async #attemptMerge(recording: RecordingRow, watchdogMs: number): Promise<MergeAttemptResult> {
    const workAbort = new AbortController();
    this.#abortControllers.set(recording.id, workAbort);
    try {
      const work = this.#mergeAllStreamKeys(recording, workAbort.signal);
      const race = await this.#raceWithWatchdog(work, watchdogMs);
      if (!race.ok) {
        workAbort.abort();
        await work.catch(() => undefined);
        return { ok: false, stopping: this.#stopping };
      }
      return { ok: true, totalBytes: race.value.sizeBytes, durationMs: race.value.durationMs };
    } finally {
      this.#abortControllers.delete(recording.id);
    }
  }

  /** Both branches always resolve (never reject) so `Promise.race` can't surface an unhandled rejection from a merge that fails instead of hanging — `work`'s own rejection handler here is what keeps Node from flagging it as unhandled. */
  async #raceWithWatchdog(work: Promise<StreamKeyOutcome>, watchdogMs: number): Promise<{ ok: true; value: StreamKeyOutcome } | { ok: false }> {
    const watchdogAbort = new AbortController();
    try {
      const settleWork = work.then(
        (value) => ({ kind: 'done', value }) as const,
        () => ({ kind: 'work-failed' }) as const,
      );
      const settleWatchdog = this.#deps.clock.sleep(watchdogMs, watchdogAbort.signal).then(() => ({ kind: 'timeout' }) as const);
      const raced = await Promise.race([settleWork, settleWatchdog]);
      if (raced.kind === 'done') return { ok: true, value: raced.value };
      return { ok: false };
    } finally {
      watchdogAbort.abort();
    }
  }

  async #mergeAllStreamKeys(recording: RecordingRow, signal: AbortSignal): Promise<StreamKeyOutcome> {
    const segmentFiles = this.#deps.db
      .select({ streamKey: recordingFiles.streamKey })
      .from(recordingFiles)
      .where(and(eq(recordingFiles.recordingId, recording.id), eq(recordingFiles.kind, 'segment')))
      .all();
    const streamKeys = [...new Set(segmentFiles.map((row) => row.streamKey))];

    let totalBytes = 0;
    let durationMs = 0;
    for (const streamKey of streamKeys) {
      const result = await this.#mergeOneStreamKey(recording, streamKey, signal);
      if (result === null) continue;
      totalBytes += result.sizeBytes;
      durationMs = Math.max(durationMs, result.durationMs);
    }
    return { sizeBytes: totalBytes, durationMs };
  }

  async #mergeOneStreamKey(recording: RecordingRow, streamKey: string, signal: AbortSignal): Promise<StreamKeyOutcome | null> {
    const rows = this.#deps.db
      .select({ file: recordingFiles, segmentIndex: recordingSegments.index })
      .from(recordingFiles)
      .innerJoin(recordingSegments, eq(recordingFiles.segmentId, recordingSegments.id))
      .where(and(eq(recordingFiles.recordingId, recording.id), eq(recordingFiles.kind, 'segment'), eq(recordingFiles.streamKey, streamKey)))
      .all();

    const segmentFiles = rows
      .filter((row) => row.file.state !== 'missing')
      .sort((a, b) => a.segmentIndex - b.segmentIndex)
      .map((row) => row.file);
    if (segmentFiles.length === 0) return null;

    const baseDir = join(this.#deps.recordingsRoot, 'sessions', recording.sessionId);
    mkdirSync(baseDir, { recursive: true });
    const hasAudio = segmentFiles[0]!.hasAudio;

    let sourcePath: string;
    if (segmentFiles.length > 1) {
      const mergedPath = join(baseDir, `merged-${streamKey}.ts`);
      if (!this.#isUpToDate(recording.id, 'merged', streamKey, mergedPath)) {
        const workDir = join(this.#deps.runtimeDir, 'artifact', recording.id);
        mkdirSync(workDir, { recursive: true });
        const manifestPath = join(workDir, `concat-${streamKey}.txt`);
        const manifest = segmentFiles.map((file) => `file '${file.path.replace(/'/g, "'\\''")}'`).join('\n') + '\n';
        writeFileSync(manifestPath, manifest, 'utf8');

        const result = await this.#deps.runner.run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', manifestPath, '-c', 'copy', mergedPath], { signal });
        if (result.code !== 0) {
          throw new Error(`ffmpeg concat failed for stream ${streamKey}: exit ${String(result.code)} ${result.stderr}`);
        }
        const probe = await this.#probe(mergedPath);
        this.#machine.upsertArtifactFile(recording.id, {
          kind: 'merged',
          streamKey,
          path: mergedPath,
          container: 'mpegts',
          sizeBytes: probe.sizeBytes,
          durationMs: probe.durationMs,
          checksum: checksumOf(mergedPath),
          hasAudio,
        });
      }
      sourcePath = mergedPath;
    } else {
      sourcePath = segmentFiles[0]!.path;
    }

    const derivedPath = join(baseDir, `${streamKey}.mp4`);
    if (this.#isUpToDate(recording.id, 'derived', streamKey, derivedPath)) {
      const existing = this.#deps.db
        .select()
        .from(recordingFiles)
        .where(and(eq(recordingFiles.recordingId, recording.id), eq(recordingFiles.kind, 'derived'), eq(recordingFiles.streamKey, streamKey)))
        .get()!;
      return { sizeBytes: existing.sizeBytes ?? 0, durationMs: existing.durationMs ?? 0 };
    }

    const result = await this.#deps.runner.run('ffmpeg', ['-y', '-i', sourcePath, '-c', 'copy', derivedPath], { signal });
    if (result.code !== 0) {
      throw new Error(`ffmpeg remux failed for stream ${streamKey}: exit ${String(result.code)} ${result.stderr}`);
    }
    const probe = await this.#probe(derivedPath);
    this.#machine.upsertArtifactFile(recording.id, {
      kind: 'derived',
      streamKey,
      path: derivedPath,
      container: 'mp4',
      sizeBytes: probe.sizeBytes,
      durationMs: probe.durationMs,
      checksum: checksumOf(derivedPath),
      hasAudio,
    });
    return { sizeBytes: probe.sizeBytes, durationMs: probe.durationMs };
  }

  /** BR-7: skips re-running ffmpeg for a `merged`/`derived` output whose on-disk checksum still matches the persisted row (crash/retry re-entry). */
  #isUpToDate(recordingId: string, kind: 'merged' | 'derived', streamKey: string, path: string): boolean {
    if (!existsSync(path)) return false;
    const existing = this.#deps.db
      .select()
      .from(recordingFiles)
      .where(and(eq(recordingFiles.recordingId, recordingId), eq(recordingFiles.kind, kind), eq(recordingFiles.streamKey, streamKey)))
      .get();
    if (!existing || existing.checksum === null) return false;
    return checksumOf(path) === existing.checksum;
  }

  async #probe(path: string): Promise<ProbeOutcome> {
    let sizeBytes: number;
    try {
      sizeBytes = statSync(path).size;
    } catch {
      return { sizeBytes: 0, durationMs: 0, playable: false };
    }
    if (sizeBytes === 0) return { sizeBytes: 0, durationMs: 0, playable: false };

    const result = await this.#deps.runner.run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path]);
    if (result.code !== 0) return { sizeBytes, durationMs: 0, playable: false };

    try {
      const parsed = JSON.parse(result.stdout) as { format?: { duration?: string }; streams?: unknown[] };
      const durationSec = Number(parsed.format?.duration ?? '0');
      const playable = Array.isArray(parsed.streams) && parsed.streams.length > 0 && Number.isFinite(durationSec) && durationSec > 0;
      return { sizeBytes, durationMs: playable ? Math.round(durationSec * 1000) : 0, playable };
    } catch {
      return { sizeBytes, durationMs: 0, playable: false };
    }
  }
}
