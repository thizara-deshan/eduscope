import type { OutputSpec } from '@eduscope/shared';
import { eq } from 'drizzle-orm';
import type { DrizzleDb } from '../../db/client.js';
import { recordingFiles, recordingSegments } from '../../db/schema.js';
import type { IdGenerator } from '../../lib/ids.js';

/** The transaction handle `db.transaction((tx) => ...)` passes to its callback (drizzle-orm/better-sqlite3). */
export type Tx = Parameters<Parameters<DrizzleDb['transaction']>[0]>[0];

/**
 * Deterministic per-output segment paths (SEG-7) — the same shape B-05's
 * start path already sends to pipeline-manager, generalized to any segment
 * index so pause/resume/stop can each address the segment they close without
 * parsing anything back from the manager.
 */
export function segmentOutputPaths(
  recordingsRoot: string,
  sessionId: string,
  segmentIndex: number,
  outputs: readonly OutputSpec[],
): Record<string, string> {
  const paddedIndex = String(segmentIndex).padStart(3, '0');
  const base = `${recordingsRoot}/sessions/${sessionId}`;
  if (outputs.length <= 1) {
    const streamKey = outputs[0]?.streamKey ?? 'main';
    return { [streamKey]: `${base}/seg-${paddedIndex}.ts` };
  }
  const result: Record<string, string> = {};
  for (const output of outputs) {
    result[output.streamKey] = `${base}/seg-${paddedIndex}-${output.streamKey}.ts`;
  }
  return result;
}

export interface CloseSegmentInput {
  segment: { id: string; index: number; startedAt: string };
  recordingId: string;
  sessionId: string;
  now: Date;
  ids: IdGenerator;
  endReason: 'pause' | 'stop';
  /** Whether the consumer confirmed EOS before the local timeout — false marks the segment `truncated` (R-09/R-13) rather than `finalized` (R-08/R-12). */
  graceful: boolean;
  outputs: readonly OutputSpec[];
  recordingsRoot: string;
}

export interface ClosedSegment {
  id: string;
  index: number;
  durationMs: number;
  state: 'finalized' | 'truncated';
}

/**
 * SEG-1 (close half): ends the open segment and records its outcome.
 * SEG-3: writes one `RecordingFile` row per `LayoutPreset.outputs` entry for
 * this segment (the `separate-files` twin, or one row for every other
 * preset). File `state` follows INV-RF-2 — `finalized` only after graceful
 * EOS, `writing` (never a falsely "done" `truncated`) otherwise; `sizeBytes`/
 * `durationMs`/`checksum` stay null for machine 1b's later probe to fill
 * (design/core-api.md §5.1 — probing is owned there, not here).
 */
export function closeSegment(tx: Tx, input: CloseSegmentInput): ClosedSegment {
  const startedAtMs = new Date(input.segment.startedAt).getTime();
  const durationMs = Math.max(0, input.now.getTime() - startedAtMs);
  const state: 'finalized' | 'truncated' = input.graceful ? 'finalized' : 'truncated';

  tx.update(recordingSegments)
    .set({ endedAt: input.now.toISOString(), durationMs, endReason: input.endReason, state })
    .where(eq(recordingSegments.id, input.segment.id))
    .run();

  const paths = segmentOutputPaths(input.recordingsRoot, input.sessionId, input.segment.index, input.outputs);
  for (const output of input.outputs) {
    tx.insert(recordingFiles)
      .values({
        id: input.ids.next(input.now),
        recordingId: input.recordingId,
        segmentId: input.segment.id,
        kind: 'segment',
        streamKey: output.streamKey,
        path: paths[output.streamKey]!,
        container: 'mpegts',
        durationMs,
        state: input.graceful ? 'finalized' : 'writing',
        hasAudio: output.includeAudio,
        isUploadable: false,
      })
      .run();
  }

  return { id: input.segment.id, index: input.segment.index, durationMs, state };
}

/** `LectureSession.recordedDurationMs` (B-08 fix): sum of closed segments' clock-measured durations — pause gaps are excluded because each segment only counts its own capturing span. */
export function sumRecordedDurationMs(tx: Tx, recordingId: string): number {
  const rows = tx
    .select({ durationMs: recordingSegments.durationMs })
    .from(recordingSegments)
    .where(eq(recordingSegments.recordingId, recordingId))
    .all();
  return rows.reduce((sum, row) => sum + (row.durationMs ?? 0), 0);
}
