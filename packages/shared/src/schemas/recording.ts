import { z } from 'zod';
import { Instant, Ulid } from './primitives';
import {
  DeleteReason,
  LayoutPresetId,
  MediaContainer,
  MergeState,
  RecordingFileKind,
  RecordingFileState,
  RecordingState,
  SegmentEndReason,
  SegmentState,
  UploadJobState,
} from './enums';

/** Context C — artifacts (domain model §6.2–6.4). One lecture = one Recording (INV-RC-1). */

export const RecordingSegment = z.object({
  id: Ulid,
  recordingId: Ulid,
  /** 0-based ordinal — ordering metadata, never id arithmetic (INV-RS-1). */
  index: z.number().int().nonnegative(),
  startedAt: Instant,
  endedAt: Instant.nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  endReason: SegmentEndReason.nullable(),
  state: SegmentState,
});
export type RecordingSegment = z.infer<typeof RecordingSegment>;

/** No consumer parses filenames for metadata — path is opaque (INV-RF-1, B-02). */
export const RecordingFile = z.object({
  id: Ulid,
  recordingId: Ulid,
  segmentId: Ulid.nullable(), // null for merged/derived
  kind: RecordingFileKind,
  streamKey: z.string().max(32), // from LayoutPreset.outputs — the ~1/~2 successor
  container: MediaContainer,
  sizeBytes: z.number().int().nonnegative().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  state: RecordingFileState,
  hasAudio: z.boolean(),
  isUploadable: z.boolean(),
});
export type RecordingFile = z.infer<typeof RecordingFile>;

/** Library list row (LP-10). Ownership filtering is server-side (INV-RC-5). */
export const Recording = z.object({
  id: Ulid,
  sessionId: Ulid,
  title: z.string(), // session snapshot, for the library row
  hallDisplayName: z.string(),
  ownerUserId: Ulid,
  ownerDisplayName: z.string(),
  startedAt: Instant,
  endedAt: Instant.nullable(),
  state: RecordingState,
  layoutPresetId: LayoutPresetId,
  durationMs: z.number().int().nonnegative().nullable(),
  totalBytes: z.number().int().nonnegative().nullable(),
  segmentCount: z.number().int().positive(),
  mergeState: MergeState,
  /** [derived] from UploadJob — the library badge, never a second truth. */
  uploadState: UploadJobState.nullable(),
  retentionDeleteAfter: Instant, // endedAt + 14 days (A-20) [D-15]
  deletedAt: Instant.nullable(),
  deleteReason: DeleteReason.nullable(),
});
export type Recording = z.infer<typeof Recording>;

/** Detail view: row + segments + files (playback/download pick a file id). */
export const RecordingDetail = Recording.extend({
  segments: z.array(RecordingSegment),
  files: z.array(RecordingFile),
});
export type RecordingDetail = z.infer<typeof RecordingDetail>;
