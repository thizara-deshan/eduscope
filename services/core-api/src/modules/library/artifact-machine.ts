import { and, eq } from 'drizzle-orm';
import type { DrizzleDb } from '../../db/client.js';
import { lectureSessions, recordingFiles, recordings, retentionPolicy } from '../../db/schema.js';
import type { Clock } from '../../lib/clock.js';
import type { IdGenerator } from '../../lib/ids.js';

const DEFAULT_RETENTION_MAX_AGE_DAYS = 14;

export interface ArtifactMachineDeps {
  db: DrizzleDb;
  clock: Clock;
  ids: IdGenerator;
}

export interface ProbeResult {
  fileId: string;
  sizeBytes: number;
  durationMs: number;
  playable: boolean;
}

/** RA-07 refusal (design/core-api.md §5.1, F-8): `retryMergeRecording` on a recording that isn't `failed`. */
export class ArtifactRetryNotAllowedError extends Error {
  constructor(recordingId: string, state: string) {
    super(`ArtifactMachine.resetForRetry: recording ${recordingId} is ${state}, not failed`);
  }
}

type RecordingRow = typeof recordings.$inferSelect;

/**
 * The only code that writes `recordings.state`/`mergeState` and machine-1b's
 * `recording_files` rows (RA-01..RA-07, design/core-api.md §5.1). B-13's
 * `ArtifactExecutor` (merge-worker.ts) is the only caller — it sequences
 * these transitions around the actual (transaction-free) ffprobe/ffmpeg work.
 */
export class ArtifactMachine {
  readonly #deps: ArtifactMachineDeps;

  constructor(deps: ArtifactMachineDeps) {
    this.#deps = deps;
  }

  /** `capturing` → `finalizing` (RA-01/RA-02 entry). Idempotent — a re-entry (duplicate `recording.state` event, manual retry) that finds any later state is a no-op so the caller can treat this as "safe to call, then check the result". */
  enterFinalizing(recordingId: string): RecordingRow {
    const { db } = this.#deps;
    let result!: RecordingRow;
    db.transaction((tx) => {
      const recording = tx.select().from(recordings).where(eq(recordings.id, recordingId)).get();
      if (!recording) {
        throw new Error(`ArtifactMachine.enterFinalizing: unknown recording ${recordingId}`);
      }
      if (recording.state === 'capturing') {
        tx.update(recordings).set({ state: 'finalizing' }).where(eq(recordings.id, recordingId)).run();
      }
      result = tx.select().from(recordings).where(eq(recordings.id, recordingId)).get()!;
    });
    return result;
  }

  /** Persists ffprobe results for every segment file (outside any transaction — the probe itself already ran). RA-05: zero-byte or unplayable files are marked `missing` (excluded from merge input, never deleted — SEG note INV-RF-2's counterpart for machine 1b). */
  applyProbeResults(results: readonly ProbeResult[]): void {
    if (results.length === 0) return;
    const { db } = this.#deps;
    db.transaction((tx) => {
      for (const result of results) {
        const playable = result.playable && result.sizeBytes > 0;
        tx.update(recordingFiles)
          .set({
            sizeBytes: result.sizeBytes,
            durationMs: result.durationMs,
            state: playable ? 'finalized' : 'missing',
          })
          .where(eq(recordingFiles.id, result.fileId))
          .run();
      }
    });
  }

  /** `finalizing` → `merging`, `mergeState` `pending` → `running`. Idempotent — already-`merging` (crash/retry re-entry) is a no-op. */
  enterMerging(recordingId: string): RecordingRow {
    const { db } = this.#deps;
    let result!: RecordingRow;
    db.transaction((tx) => {
      const recording = tx.select().from(recordings).where(eq(recordings.id, recordingId)).get();
      if (!recording) {
        throw new Error(`ArtifactMachine.enterMerging: unknown recording ${recordingId}`);
      }
      if (recording.state === 'finalizing') {
        tx.update(recordings).set({ state: 'merging', mergeState: 'running' }).where(eq(recordings.id, recordingId)).run();
      }
      result = tx.select().from(recordings).where(eq(recordings.id, recordingId)).get()!;
    });
    return result;
  }

  /**
   * Upserts one `merged` or `derived` `recording_files` row for `streamKey`
   * (BR-7 idempotent re-entry: a second merge pass for the same recording
   * overwrites the same row rather than inserting a duplicate). Never touches
   * `kind='segment'` rows — the raw `.ts` capture is preserved unconditionally
   * (KEEP B-23).
   */
  upsertArtifactFile(
    recordingId: string,
    input: {
      kind: 'merged' | 'derived';
      streamKey: string;
      path: string;
      container: 'mpegts' | 'mp4';
      sizeBytes: number;
      durationMs: number;
      checksum: string;
      hasAudio: boolean;
    },
  ): void {
    const { db, clock, ids } = this.#deps;
    db.transaction((tx) => {
      const existing = tx
        .select()
        .from(recordingFiles)
        .where(and(eq(recordingFiles.recordingId, recordingId), eq(recordingFiles.kind, input.kind), eq(recordingFiles.streamKey, input.streamKey)))
        .get();

      const values = {
        path: input.path,
        container: input.container,
        sizeBytes: input.sizeBytes,
        durationMs: input.durationMs,
        checksum: input.checksum,
        state: 'finalized' as const,
        hasAudio: input.hasAudio,
        isUploadable: input.kind === 'derived',
      };

      if (existing) {
        tx.update(recordingFiles).set(values).where(eq(recordingFiles.id, existing.id)).run();
      } else {
        tx.insert(recordingFiles)
          .values({ id: ids.next(clock.now()), recordingId, segmentId: null, kind: input.kind, streamKey: input.streamKey, ...values })
          .run();
      }
    });
  }

  /** RA-03/RA-02 → `ready`: `mergeState` `running` → `done`, retention recomputed from the real `endedAt` (machine.ts's placeholder comment). */
  markReady(recordingId: string, totalBytes: number, durationMs: number): RecordingRow {
    const { db, clock } = this.#deps;
    let result!: RecordingRow;
    db.transaction((tx) => {
      const recording = tx.select().from(recordings).where(eq(recordings.id, recordingId)).get();
      if (!recording) {
        throw new Error(`ArtifactMachine.markReady: unknown recording ${recordingId}`);
      }
      const session = tx.select().from(lectureSessions).where(eq(lectureSessions.id, recording.sessionId)).get();
      const policy = tx.select({ maxAgeDays: retentionPolicy.maxAgeDays }).from(retentionPolicy).where(eq(retentionPolicy.id, 'retention-policy')).get();
      const maxAgeDays = policy?.maxAgeDays ?? DEFAULT_RETENTION_MAX_AGE_DAYS;
      const endedAtMs = session?.endedAt !== null && session?.endedAt !== undefined ? new Date(session.endedAt).getTime() : clock.now().getTime();
      const retentionDeleteAfter = new Date(endedAtMs + maxAgeDays * 24 * 60 * 60 * 1000).toISOString();

      tx.update(recordings)
        .set({ state: 'ready', mergeState: 'done', totalBytes, durationMs, retentionDeleteAfter })
        .where(eq(recordings.id, recordingId))
        .run();
      result = tx.select().from(recordings).where(eq(recordings.id, recordingId)).get()!;
    });
    return result;
  }

  /** RA-04: `failed` (+ `mergeState` `failed`) after the watchdog/retry budget is exhausted. INV-UJ-3: no upload job is ever created from this path. */
  markFailed(recordingId: string): RecordingRow {
    const { db } = this.#deps;
    let result!: RecordingRow;
    db.transaction((tx) => {
      tx.update(recordings).set({ state: 'failed', mergeState: 'failed' }).where(eq(recordings.id, recordingId)).run();
      result = tx.select().from(recordings).where(eq(recordings.id, recordingId)).get()!;
    });
    return result;
  }

  /** RA-07 (`retryMergeRecording`, admin-only at the route layer — B-14): only a `failed` recording may restart; resets `mergeState` and re-enters `finalizing` so probe+merge run again (checksummed re-entry skips already-good outputs). */
  resetForRetry(recordingId: string): RecordingRow {
    const { db } = this.#deps;
    let result!: RecordingRow;
    db.transaction((tx) => {
      const recording = tx.select().from(recordings).where(eq(recordings.id, recordingId)).get();
      if (!recording) {
        throw new Error(`ArtifactMachine.resetForRetry: unknown recording ${recordingId}`);
      }
      if (recording.state !== 'failed') {
        throw new ArtifactRetryNotAllowedError(recordingId, recording.state);
      }
      tx.update(recordings).set({ state: 'finalizing', mergeState: 'pending' }).where(eq(recordings.id, recordingId)).run();
      result = tx.select().from(recordings).where(eq(recordings.id, recordingId)).get()!;
    });
    return result;
  }
}
