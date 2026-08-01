import { z } from 'zod';

/**
 * Closed enums (domain-model.md type vocabulary: adding a value is a contract
 * change — INV-SR-1 and friends).
 */

// ── Context A — sources, layouts, channels ──────────────────────────────────

/** Canonical source vocabulary (domain model §4.5). `mic-room` is reserved and must stay unbound in V1 (INV-SR-2, DM-11). */
export const SourceRoleId = z.enum([
  'presentation',
  'lecturer-cam',
  'students-cam',
  'mic-lecturer',
  'mic-room',
]);
export type SourceRoleId = z.infer<typeof SourceRoleId>;

export const SourceMedium = z.enum(['video', 'audio']);
export type SourceMedium = z.infer<typeof SourceMedium>;

export const PhysicalInputKind = z.enum(['v4l2', 'rtsp', 'alsa']);
export type PhysicalInputKind = z.infer<typeof PhysicalInputKind>;

export const PresenceState = z.enum(['present', 'absent', 'error', 'unknown']);
export type PresenceState = z.infer<typeof PresenceState>;

/** Machine 5a — per-SourceRole health as the panel sees it (HL-01…HL-09). */
export const SourceHealthState = z.enum([
  'unknown',
  'unbound',
  'online',
  'degraded',
  'offline',
]);
export type SourceHealthState = z.infer<typeof SourceHealthState>;

export const ChannelId = z.enum(['local', 'meeting', 'streaming']);
export type ChannelId = z.infer<typeof ChannelId>;

/** Machine 1c runtime state of the meeting/streaming consumers (CH-01…CH-10). `local` is machine 1a's. */
export const ChannelRuntimeState = z.enum([
  'off',
  'preflight',
  'starting',
  'on',
  'stopping',
  'failed',
]);
export type ChannelRuntimeState = z.infer<typeof ChannelRuntimeState>;

/** A-09 amended; prototype LayoutPresetId is the vocabulary (domain model §4.10). */
export const LayoutPresetId = z.enum([
  'fifty-fifty',
  'cams-fifty-fifty',
  'side-by-side',
  'cam-1',
  'cam-2',
  'pc-only',
  'separate-files',
]);
export type LayoutPresetId = z.infer<typeof LayoutPresetId>;

export const LayoutKind = z.enum(['single', 'composite', 'multi-file']);
export type LayoutKind = z.infer<typeof LayoutKind>;

export const AppliedState = z.enum(['applied', 'pending', 'failed']);
export type AppliedState = z.infer<typeof AppliedState>;

/** [D-19] — Twitch/LinkedIn reachable via custom-rtmp; no per-platform tiles. */
export const StreamPlatform = z.enum(['youtube', 'facebook', 'custom-rtmp']);
export type StreamPlatform = z.infer<typeof StreamPlatform>;

// ── Context A — device, storage, network ────────────────────────────────────

export const StoragePressure = z.enum(['ok', 'warning', 'critical']);
export type StoragePressure = z.infer<typeof StoragePressure>;

/** `unknown` is a legitimate value — never hardcode "Good" (domain model §4.2). */
export const SmartStatus = z.enum(['good', 'warning', 'failing', 'unknown']);
export type SmartStatus = z.infer<typeof SmartStatus>;

export const CaptureCardState = z.enum(['present', 'absent', 'recovering', 'failed']);
export type CaptureCardState = z.infer<typeof CaptureCardState>;

export const StorageVolumeRole = z.enum(['recordings', 'system']);
export type StorageVolumeRole = z.infer<typeof StorageVolumeRole>;

export const StorageVolumeState = z.enum([
  'registered',
  'mounted',
  'missing',
  'formatting',
  'failed',
]);
export type StorageVolumeState = z.infer<typeof StorageVolumeState>;

export const NetworkKind = z.enum(['lan', 'vlan']);
export type NetworkKind = z.infer<typeof NetworkKind>;

export const AddressMode = z.enum(['dhcp', 'static']);
export type AddressMode = z.infer<typeof AddressMode>;

export const FirmwareState = z.enum([
  'idle',
  'checking',
  'downloading',
  'verifying',
  'applying',
  'rolled-back',
  'failed',
  'done',
]);
export type FirmwareState = z.infer<typeof FirmwareState>;

// ── Context B — identity ────────────────────────────────────────────────────

/** DM-2: dev-admin does not exist. */
export const UserRole = z.enum(['lecturer', 'admin']);
export type UserRole = z.infer<typeof UserRole>;

export const UserSource = z.enum(['local', 'institute']);
export type UserSource = z.infer<typeof UserSource>;

export const AuthClient = z.enum(['panel', 'admin', 'api']);
export type AuthClient = z.infer<typeof AuthClient>;

export const ImportBatchState = z.enum(['validating', 'rejected', 'applied']);
export type ImportBatchState = z.infer<typeof ImportBatchState>;

// ── Context C — capture ─────────────────────────────────────────────────────

/**
 * Machine 1a persisted states (LP-4 + persistence-only states). `idle` is the
 * absence of a non-terminal session — it appears on the wire (recording.state)
 * but never as a row.
 */
export const LectureSessionState = z.enum([
  'starting',
  'recording',
  'paused',
  'stopping',
  'finalizing',
  'completed',
  'error',
]);
export type LectureSessionState = z.infer<typeof LectureSessionState>;

export const RecordingWireState = z.enum([
  'idle',
  'starting',
  'recording',
  'paused',
  'stopping',
  'finalizing',
  'completed',
  'error',
]);
export type RecordingWireState = z.infer<typeof RecordingWireState>;

export const StartReason = z.enum(['initial', 'resume', 'recovery']);
export type StartReason = z.infer<typeof StartReason>;

export const RecoveryOutcome = z.enum(['auto-resumed', 'finalized']);
export type RecoveryOutcome = z.infer<typeof RecoveryOutcome>;

/** Machine 1b — Recording.state (RA-01…RA-07). */
export const RecordingState = z.enum([
  'capturing',
  'finalizing',
  'merging',
  'ready',
  'failed',
  'deleted',
]);
export type RecordingState = z.infer<typeof RecordingState>;

export const MergeState = z.enum(['not-needed', 'pending', 'running', 'done', 'failed']);
export type MergeState = z.infer<typeof MergeState>;

export const DeleteReason = z.enum(['admin', 'retention', 'disk-pressure']);
export type DeleteReason = z.infer<typeof DeleteReason>;

export const SegmentState = z.enum([
  'capturing',
  'finalizing',
  'finalized',
  'truncated',
  'failed',
]);
export type SegmentState = z.infer<typeof SegmentState>;

export const SegmentEndReason = z.enum(['pause', 'stop', 'crash', 'error', 'takeover']);
export type SegmentEndReason = z.infer<typeof SegmentEndReason>;

export const RecordingFileKind = z.enum(['segment', 'merged', 'derived']);
export type RecordingFileKind = z.infer<typeof RecordingFileKind>;

export const RecordingFileState = z.enum(['writing', 'finalized', 'missing', 'deleted']);
export type RecordingFileState = z.infer<typeof RecordingFileState>;

export const MediaContainer = z.enum(['mpegts', 'mp4']);
export type MediaContainer = z.infer<typeof MediaContainer>;

export const ExportJobState = z.enum([
  'queued',
  'copying',
  'completed',
  'failed',
  'cancelled',
]);
export type ExportJobState = z.infer<typeof ExportJobState>;

// ── Context D — distribution ────────────────────────────────────────────────

/** Machine 3a (U-01…U-10). `completing` = the add→upload→complete third call [D-02b]. */
export const UploadJobState = z.enum([
  'queued',
  'uploading',
  'completing',
  'done',
  'failed',
  'dead-letter',
  'cancelled',
]);
export type UploadJobState = z.infer<typeof UploadJobState>;

export const UploadFilePartState = z.enum([
  'pending',
  'uploading',
  'uploaded',
  'missing',
  'failed',
]);
export type UploadFilePartState = z.infer<typeof UploadFilePartState>;

// ── Context E — AI & quiz ───────────────────────────────────────────────────

/** Machine 2a (Q-01…Q-10). */
export const AiCountdownState = z.enum([
  'unavailable',
  'armed',
  'generating',
  'held',
  'degraded',
]);
export type AiCountdownState = z.infer<typeof AiCountdownState>;

/** A-14; default 20 (INT-11). */
export const IntervalMinutes = z.union([
  z.literal(10),
  z.literal(15),
  z.literal(20),
  z.literal(30),
]);
export type IntervalMinutes = z.infer<typeof IntervalMinutes>;

export const QuestionSetTrigger = z.enum(['countdown', 'manual']);
export type QuestionSetTrigger = z.infer<typeof QuestionSetTrigger>;

/** Machine 2b (Q-11…Q-17). */
export const QuestionSetState = z.enum([
  'requested',
  'generating',
  'ready',
  'failed',
  'reviewed',
  'discarded',
]);
export type QuestionSetState = z.infer<typeof QuestionSetState>;

/** V1 rejects anything but `mcq` (A-14, DM-12). */
export const QuestionKind = z.enum(['mcq', 'short']);
export type QuestionKind = z.infer<typeof QuestionKind>;

export const QuestionProvenance = z.enum(['generated', 'lecturer-authored']);
export type QuestionProvenance = z.infer<typeof QuestionProvenance>;

/** Machine 2c (Q-18…Q-23). */
export const QuestionState = z.enum(['draft', 'sent', 'closed', 'discarded']);
export type QuestionState = z.infer<typeof QuestionState>;

export const OptionLabel = z.enum(['A', 'B', 'C', 'D']);
export type OptionLabel = z.infer<typeof OptionLabel>;

/** Machine 2d (Q-30…Q-36). */
export const PublicationState = z.enum(['publishing', 'open', 'closed', 'failed']);
export type PublicationState = z.infer<typeof PublicationState>;

export const PublicationCloseReason = z.enum([
  'next-question',
  'session-ended',
  'lecturer-closed',
]);
export type PublicationCloseReason = z.infer<typeof PublicationCloseReason>;

export const ProjectorState = z.enum(['not-shown', 'showing', 'withdrawn']);
export type ProjectorState = z.infer<typeof ProjectorState>;

/** Machine 4d (Z-30…Z-33). */
export const QuizSyncState = z.enum(['synced', 'stale', 'failed']);
export type QuizSyncState = z.infer<typeof QuizSyncState>;

/** Quiz-service authority states (SM-D-2). */
export const QuizSessionState = z.enum(['open', 'closed']);
export type QuizSessionState = z.infer<typeof QuizSessionState>;

/** Machine 4a — device-side projection states. */
export const QuizSessionProjectionState = z.enum([
  'absent',
  'requesting',
  'open',
  'closed',
  'failed',
]);
export type QuizSessionProjectionState = z.infer<typeof QuizSessionProjectionState>;

export const ParticipantConnectionState = z.enum(['online', 'offline']);
export type ParticipantConnectionState = z.infer<typeof ParticipantConnectionState>;

// ── Context F — observability ───────────────────────────────────────────────

export const LogLevel = z.enum(['INFO', 'WARN', 'ERROR']);
export type LogLevel = z.infer<typeof LogLevel>;

/** The taxonomy is a contract every service honors (AD-7). */
export const LogCategory = z.enum(['Auth', 'System', 'Hardware', 'Session']);
export type LogCategory = z.infer<typeof LogCategory>;

export const LogService = z.enum([
  'core-api',
  'pipeline-manager',
  'ai',
  'deploy',
  'quiz-sync',
]);
export type LogService = z.infer<typeof LogService>;

export const AlertSeverity = z.enum(['info', 'warning', 'error', 'critical']);
export type AlertSeverity = z.infer<typeof AlertSeverity>;

export const AlertClearedReason = z.enum(['resolved', 'acknowledged', 'superseded']);
export type AlertClearedReason = z.infer<typeof AlertClearedReason>;
