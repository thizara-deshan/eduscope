import { z } from 'zod';
import { Instant, Ulid } from './primitives';
import { UploadFilePartState, UploadJobState } from './enums';

/**
 * Context D — upload queue (domain model §7.1–7.2, machine 3).
 * One job per Recording (INV-UJ-1, DM-3); per-file state lives on the parts.
 * The adapter protocol shape is [D-02b] — job/part STATES do not move when the
 * institute spec lands (A-19).
 */

/** Placeholder metadata manifest until [D-02b] lands. */
export const UploadMetadata = z.object({
  title: z.string(), // A-07 generated title — the upload key (INV-LS-5)
  hallCode: z.string(),
  startedAt: Instant,
  endedAt: Instant,
  recordedDurationMs: z.number().int().nonnegative(),
  /** Segment/stream manifest — exact shape [D-02b]. */
  files: z.array(
    z.object({
      streamKey: z.string(),
      sizeBytes: z.number().int().nonnegative(),
      durationMs: z.number().int().nonnegative().nullable(),
      checksum: z.string().nullable(),
    }),
  ),
});
export type UploadMetadata = z.infer<typeof UploadMetadata>;

export const UploadFilePart = z.object({
  id: Ulid,
  uploadJobId: Ulid,
  recordingFileId: Ulid, // parts addressed by file id, never position (INV-UP-1)
  streamKey: z.string().max(32),
  state: UploadFilePartState,
  bytesTotal: z.number().int().nonnegative(),
  bytesSent: z.number().int().nonnegative(),
  attempt: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
});
export type UploadFilePart = z.infer<typeof UploadFilePart>;

/** AD-9 queue row. `failed` is retryable; `dead-letter` is terminal-until-operator and always visible (INV-UJ-4). */
export const UploadJob = z.object({
  id: Ulid,
  recordingId: Ulid,
  recordingTitle: z.string(), // denormalized for the AD-9 row
  adapterId: z.string().max(64), // [D-02b] — `placeholder` until the spec lands
  state: UploadJobState,
  attempt: z.number().int().nonnegative(),
  nextAttemptAt: Instant.nullable(),
  lastError: z.string().nullable(),
  lastErrorAt: Instant.nullable(),
  remoteLectureId: z.string().max(128).nullable(), // [D-02b]
  /** 0–100; derived from part bytes. */
  progressPct: z.number().min(0).max(100),
  /** `merge` while the artifact is still merging — AD-9 renders "Preparing…" (SM-D-1). */
  blockedBy: z.enum(['merge']).nullable(),
  enqueuedAt: Instant, // immediate on recording ready [D-13]
  startedAt: Instant.nullable(),
  completedAt: Instant.nullable(),
  requeuedAt: Instant.nullable(), // manual re-enqueue from AD-9 (U-09) [D-13]
});
export type UploadJob = z.infer<typeof UploadJob>;

export const UploadJobDetail = UploadJob.extend({
  parts: z.array(UploadFilePart),
  metadata: UploadMetadata, // [D-02b]
});
export type UploadJobDetail = z.infer<typeof UploadJobDetail>;
