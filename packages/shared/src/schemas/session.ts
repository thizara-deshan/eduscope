import { z } from 'zod';
import { Instant, Ulid } from './primitives';
import {
  ChannelId,
  LayoutPresetId,
  LectureSessionState,
  RecordingWireState,
  RecoveryOutcome,
  SourceRoleId,
  StartReason,
} from './enums';

/** Context C — LectureSession (domain model §6.1). Single writer: core-api. */

export const ChannelActivation = z.object({
  channelId: ChannelId,
  presetId: LayoutPresetId,
  ratioA: z.number().int().nullable(),
  ratioB: z.number().int().nullable(),
  enabledAt: Instant,
  disabledAt: Instant.nullable(),
});
export type ChannelActivation = z.infer<typeof ChannelActivation>;

export const SourceSnapshotEntry = z.object({
  inputId: Ulid,
  address: z.string(),
});
export type SourceSnapshotEntry = z.infer<typeof SourceSnapshotEntry>;

export const LectureSession = z.object({
  id: Ulid,
  /** Generated at start from DeviceProvisioning.titlePattern (A-07) — never lecturer-entered. Immutable (INV-LS-5). P-1 */
  title: z.string().max(256),
  hallCode: z.string().max(32), // snapshot at start
  hallDisplayName: z.string().max(128),
  deviceId: Ulid,
  ownerUserId: Ulid,
  ownerDisplayName: z.string().max(128),
  startedByActor: z.literal('user'), // [D-18] closed: no scheduler actor
  state: LectureSessionState,
  startedAt: Instant,
  endedAt: Instant.nullable(),
  wallDurationMs: z.number().int().nonnegative().nullable(),
  /** Sum of segment durations excluding pause gaps — the honest figure (B-08 fix). */
  recordedDurationMs: z.number().int().nonnegative().nullable(),
  pauseCount: z.number().int().nonnegative(),
  channelActivations: z.array(ChannelActivation),
  sourceSnapshot: z.record(SourceRoleId, SourceSnapshotEntry), // INV-SB-2
  errorCode: z.string().max(64).nullable(), // populated iff state = error (SM-R-4)
  errorMessage: z.string().nullable(),
  recoveredAt: Instant.nullable(), // INT-7
  recoveryOutcome: RecoveryOutcome.nullable(),
  aiEnabledAtStart: z.boolean(), // INT-10, LP-18
  takeoverBy: Ulid.nullable(), // LP-6
  takeoverAt: Instant.nullable(),
});
export type LectureSession = z.infer<typeof LectureSession>;

/**
 * The panel's cold-boot snapshot of machine 1a — the REST mirror of the
 * `recording.state` event. `state: 'idle'` ⇒ every session field is null
 * (idle is the absence of a non-terminal session, domain model §6.1).
 */
export const RecordingStateSnapshot = z.object({
  state: RecordingWireState,
  startReason: StartReason.nullable(),
  sessionId: Ulid.nullable(),
  title: z.string().nullable(),
  ownerUserId: Ulid.nullable(),
  ownerDisplayName: z.string().nullable(),
  startedAt: Instant.nullable(),
  recordedDurationMs: z.number().int().nonnegative().nullable(),
  segmentIndex: z.number().int().nonnegative().nullable(),
  segmentCount: z.number().int().nonnegative().nullable(),
  pauseCount: z.number().int().nonnegative().nullable(),
  takeoverBy: Ulid.nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  /** BR-1: core-api restarted alone and re-attached to a live consumer. */
  adopted: z.boolean().optional(),
});
export type RecordingStateSnapshot = z.infer<typeof RecordingStateSnapshot>;
