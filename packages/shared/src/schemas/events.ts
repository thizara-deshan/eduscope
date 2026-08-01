import { z } from 'zod';
import { Instant, Ulid } from './primitives';
import {
  AiCountdownState,
  CaptureCardState,
  ChannelId,
  ChannelRuntimeState,
  DeleteReason,
  ExportJobState,
  FirmwareState,
  IntervalMinutes,
  LayoutPresetId,
  MergeState,
  OptionLabel,
  ParticipantConnectionState,
  ProjectorState,
  PublicationCloseReason,
  PublicationState,
  QuestionProvenance,
  QuestionSetState,
  QuestionSetTrigger,
  QuestionState,
  QuizSessionProjectionState,
  QuizSyncState,
  RecordingState,
  RecordingWireState,
  SegmentEndReason,
  SegmentState,
  SmartStatus,
  SourceHealthState,
  SourceRoleId,
  StartReason,
  StoragePressure,
  UploadFilePartState,
  UploadJobState,
} from './enums';
import { AppliedState } from './enums';
import { PublisherState, RetentionPolicy } from './storage';
import { SystemAlert, LogEntry } from './observability';
import { UsbVolume } from './exports';
import { FirmwareUpdate } from './firmware';

/**
 * WebSocket event catalog — the zod half of contracts/events.md.
 * Server→client only on the event channel; commands go over REST
 * (target-architecture §2.1). Every event carries { event, at, seq, payload };
 * seq is per-connection monotonic — a gap forces a full resync (state-machines
 * §5.5). WebRTC preview signaling rides a SEPARATE socket (§3 below).
 */

export const eventEnvelope = <N extends string, P extends z.ZodTypeAny>(
  name: N,
  payload: P,
) =>
  z.object({
    event: z.literal(name),
    at: Instant,
    seq: z.number().int().nonnegative(),
    payload,
  });

// ── 1. core-api → panel/admin ───────────────────────────────────────────────

/** Machine 1a. Emitted on transition + on subscribe. */
export const RecordingStatePayload = z.object({
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
  adopted: z.boolean().optional(), // BR-1
});
export const RecordingStateEvent = eventEnvelope('recording.state', RecordingStatePayload);
export type RecordingStateEvent = z.infer<typeof RecordingStateEvent>;

/** SEG-1 bookkeeping. Emitted on segment open/close. */
export const RecordingSegmentPayload = z.object({
  sessionId: Ulid,
  recordingId: Ulid,
  segmentId: Ulid,
  index: z.number().int().nonnegative(),
  state: SegmentState,
  endReason: SegmentEndReason.nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
});
export const RecordingSegmentEvent = eventEnvelope('recording.segment', RecordingSegmentPayload);
export type RecordingSegmentEvent = z.infer<typeof RecordingSegmentEvent>;

/** Machine 1b (RA-01…RA-07). Drives the library badge and upload eligibility. */
export const RecordingArtifactPayload = z.object({
  recordingId: Ulid,
  sessionId: Ulid,
  state: RecordingState,
  mergeState: MergeState,
  durationMs: z.number().int().nonnegative().nullable(),
  totalBytes: z.number().int().nonnegative().nullable(),
  deleteReason: DeleteReason.nullable(),
});
export const RecordingArtifactEvent = eventEnvelope('recording.artifact', RecordingArtifactPayload);
export type RecordingArtifactEvent = z.infer<typeof RecordingArtifactEvent>;

/** Machine 1c (CH-01…CH-10). */
export const ChannelStatePayload = z.object({
  channelId: ChannelId,
  state: ChannelRuntimeState,
  presetId: LayoutPresetId,
  ratioA: z.number().int().nullable(),
  ratioB: z.number().int().nullable(),
  reason: z.string().nullable(), // named failure reason (CH-03/CH-06)
});
export const ChannelStateEvent = eventEnvelope('channel.state', ChannelStatePayload);
export type ChannelStateEvent = z.infer<typeof ChannelStateEvent>;

/** Machine 5a (HL-01…HL-09). Emitted on transition + on subscribe. */
export const SourcesStatusPayload = z.object({
  roleId: SourceRoleId,
  state: SourceHealthState,
  detail: z.string().nullable(),
  since: Instant,
  inputId: Ulid.nullable(),
});
export const SourcesStatusEvent = eventEnvelope('sources.status', SourcesStatusPayload);
export type SourcesStatusEvent = z.infer<typeof SourcesStatusEvent>;

/** Telemetry, never state (INV-AC-2). Throttled to ≤ 10 Hz. */
export const AudioLevelsPayload = z.object({
  roleId: SourceRoleId,
  rms: z.number().min(0).max(1),
});
export const AudioLevelsEvent = eventEnvelope('audio.levels', AudioLevelsPayload);
export type AudioLevelsEvent = z.infer<typeof AudioLevelsEvent>;

/** Applied-state push for the mic control (INV-AC-1 — the panel shows actual state, never assumed). Contract-v0 addition to state-machines §10. */
export const AudioControlPayload = z.object({
  roleId: SourceRoleId,
  gain: z.number().int().min(0).max(100),
  muted: z.boolean(),
  appliedState: AppliedState,
  lastError: z.string().nullable(),
});
export const AudioControlEvent = eventEnvelope('audio.control', AudioControlPayload);
export type AudioControlEvent = z.infer<typeof AudioControlEvent>;

/** Machine 5b. Policy quoted from RetentionPolicy so the UI never hardcodes thresholds (INV-RP-1). */
export const StorageStatusPayload = z.object({
  pressure: StoragePressure,
  freeBytes: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  policy: RetentionPolicy,
});
export const StorageStatusEvent = eventEnvelope('storage.status', StorageStatusPayload);
export type StorageStatusEvent = z.infer<typeof StorageStatusEvent>;

/** Machine 5c + publisher projections (INV-DH-2). */
export const DeviceHealthPayload = z.object({
  captureCardState: CaptureCardState,
  publisherStates: z.record(SourceRoleId, PublisherState),
  ntpSynced: z.boolean(),
  clockOffsetMs: z.number().int().nullable(),
  diskHealth: SmartStatus,
  lastBootAt: Instant,
});
export const DeviceHealthEvent = eventEnvelope('device.health', DeviceHealthPayload);
export type DeviceHealthEvent = z.infer<typeof DeviceHealthEvent>;

/** Raise/clear of a current condition (INV-SA-1/2/3). */
export const SystemAlertEvent = eventEnvelope('system.alert', SystemAlert);
export type SystemAlertEvent = z.infer<typeof SystemAlertEvent>;

/** Feeds the AD-7 SystemLogs live view (subscribed views only). */
export const LogEntryEvent = eventEnvelope('log.entry', LogEntry);
export type LogEntryEvent = z.infer<typeof LogEntryEvent>;

/**
 * Machine 2a. Emitted on transition + every T-COUNTDOWN-RESYNC (15 s) — the
 * panel renders the ticking display locally from nextAt (INV-G-7).
 */
export const AiCountdownPayload = z.object({
  state: AiCountdownState,
  remainingMs: z.number().int().nonnegative().nullable(),
  nextAt: Instant.nullable(),
  intervalMinutes: IntervalMinutes,
});
export const AiCountdownEvent = eventEnvelope('ai.countdown', AiCountdownPayload);
export type AiCountdownEvent = z.infer<typeof AiCountdownEvent>;

/**
 * Machine 2b. Supersedes the `ai.batch_ready` sketch (state-machines §10):
 * state = 'ready' IS batch-ready and drives the green banner.
 */
export const AiSetPayload = z.object({
  setId: Ulid,
  sessionId: Ulid,
  state: QuestionSetState,
  trigger: QuestionSetTrigger,
  count: z.number().int().nonnegative().nullable(), // surviving draft questions on ready
  error: z.string().nullable(),
  attempt: z.number().int().nonnegative().nullable(),
});
export const AiSetEvent = eventEnvelope('ai.set', AiSetPayload);
export type AiSetEvent = z.infer<typeof AiSetEvent>;

/** Machine 2c (Q-18…Q-23). */
export const AiQuestionPayload = z.object({
  questionId: Ulid,
  setId: Ulid.nullable(),
  state: QuestionState,
  provenance: QuestionProvenance,
  edited: z.boolean(),
});
export const AiQuestionEvent = eventEnvelope('ai.question', AiQuestionPayload);
export type AiQuestionEvent = z.infer<typeof AiQuestionEvent>;

/** Machine 4a (Z-01…Z-06). Also feeds the projector consumer's join QR. */
export const QuizSessionPayload = z.object({
  state: QuizSessionProjectionState,
  quizSessionId: Ulid.nullable(),
  joinUrl: z.string().nullable(),
  joinCode: z.string().nullable(),
  joinedCount: z.number().int().nonnegative(),
});
export const QuizSessionEvent = eventEnvelope('quiz.session', QuizSessionPayload);
export type QuizSessionEvent = z.infer<typeof QuizSessionEvent>;

/** Machine 2d (Q-30…Q-36) + machine 4d syncState. */
export const QuizPublicationPayload = z.object({
  publicationId: Ulid,
  questionId: Ulid,
  state: PublicationState,
  isShowing: z.boolean(),
  projectorState: ProjectorState,
  syncState: QuizSyncState,
  closeReason: PublicationCloseReason.nullable(),
});
export const QuizPublicationEvent = eventEnvelope('quiz.publication', QuizPublicationPayload);
export type QuizPublicationEvent = z.infer<typeof QuizPublicationEvent>;

/** Per-student answer deltas feeding the live leaderboard (LP-17). Batched; stale marks machine 4d ≥ stale (INV-AP-2). */
export const QuizResponsesPayload = z.object({
  publicationId: Ulid,
  deltas: z.array(
    z.object({
      studentIdNumber: z.string().max(32),
      displayName: z.string().max(128),
      selectedOptionId: Ulid,
      isCorrect: z.boolean(),
      responseTimeMs: z.number().int().nonnegative(),
      submittedAt: Instant,
    }),
  ),
  syncedAt: Instant,
  stale: z.boolean(),
});
export const QuizResponsesEvent = eventEnvelope('quiz.responses', QuizResponsesPayload);
export type QuizResponsesEvent = z.infer<typeof QuizResponsesEvent>;

/** Machine 3a (U-01…U-10). Progress steps ≥ 5 %. */
export const UploadJobPayload = z.object({
  jobId: Ulid,
  recordingId: Ulid,
  state: UploadJobState,
  attempt: z.number().int().nonnegative(),
  nextAttemptAt: Instant.nullable(),
  progressPct: z.number().min(0).max(100),
  lastError: z.string().nullable(),
  blockedBy: z.enum(['merge']).nullable(), // SM-D-1 "Preparing…"
});
export const UploadJobEvent = eventEnvelope('upload.job', UploadJobPayload);
export type UploadJobEvent = z.infer<typeof UploadJobEvent>;

/** Machine 3b (UP-01…UP-05). */
export const UploadPartPayload = z.object({
  partId: Ulid,
  jobId: Ulid,
  streamKey: z.string().max(32),
  state: UploadFilePartState,
  bytesSent: z.number().int().nonnegative(),
  bytesTotal: z.number().int().nonnegative(),
});
export const UploadPartEvent = eventEnvelope('upload.part', UploadPartPayload);
export type UploadPartEvent = z.infer<typeof UploadPartEvent>;

/** ExportJob progress (INV-EX-1) — scoped to the requesting AuthSession, never broadcast (B-38). Contract-v0 addition. */
export const ExportJobPayload = z.object({
  jobId: Ulid,
  state: ExportJobState,
  bytesCopied: z.number().int().nonnegative(),
  bytesTotal: z.number().int().nonnegative(),
  error: z.string().nullable(),
});
export const ExportJobEvent = eventEnvelope('export.job', ExportJobPayload);
export type ExportJobEvent = z.infer<typeof ExportJobEvent>;

/** USB insert/remove (LP-11) — scoped to sessions with the export flow open. Contract-v0 addition. */
export const UsbVolumesPayload = z.object({
  volumes: z.array(UsbVolume),
});
export const UsbVolumesEvent = eventEnvelope('usb.volumes', UsbVolumesPayload);
export type UsbVolumesEvent = z.infer<typeof UsbVolumesEvent>;

/** AD-5 firmware progress (FirmwareUpdate has a linear entity lifecycle, no §1–6 machine). Contract-v0 addition. */
export const FirmwareStateEvent = eventEnvelope('firmware.state', FirmwareUpdate);
export type FirmwareStateEvent = z.infer<typeof FirmwareStateEvent>;

/** Every event the panel/admin WS can deliver. */
export const PanelServerEvent = z.discriminatedUnion('event', [
  RecordingStateEvent,
  RecordingSegmentEvent,
  RecordingArtifactEvent,
  ChannelStateEvent,
  SourcesStatusEvent,
  AudioLevelsEvent,
  AudioControlEvent,
  StorageStatusEvent,
  DeviceHealthEvent,
  SystemAlertEvent,
  LogEntryEvent,
  AiCountdownEvent,
  AiSetEvent,
  AiQuestionEvent,
  QuizSessionEvent,
  QuizPublicationEvent,
  QuizResponsesEvent,
  UploadJobEvent,
  UploadPartEvent,
  ExportJobEvent,
  UsbVolumesEvent,
  FirmwareStateEvent,
]);
export type PanelServerEvent = z.infer<typeof PanelServerEvent>;

// ── 2. quiz-service → student app ───────────────────────────────────────────

/**
 * Student-facing question push (Q-31/Q-33, Z-20/Z-26). NEVER carries
 * correctness before close; `ownAnswer` marks the student's locked attempt on
 * reconnect (Z-14).
 */
export const QuizQuestionPayload = z.object({
  publicationId: Ulid,
  state: z.enum(['open', 'closed', 'none']),
  prompt: z.string().nullable(),
  options: z
    .array(z.object({ id: Ulid, label: OptionLabel, text: z.string() }))
    .nullable(),
  ownAnswer: z
    .object({ selectedOptionId: Ulid, lockedAt: Instant })
    .nullable(),
});
export const QuizQuestionEvent = eventEnvelope('quiz.question', QuizQuestionPayload);
export type QuizQuestionEvent = z.infer<typeof QuizQuestionEvent>;

/** Own result + own rank ONLY — never the class list (INT-4, QZ-6, INV-SI-2). */
export const QuizResultPayload = z.object({
  publicationId: Ulid,
  isCorrect: z.boolean(),
  correctOptionId: Ulid, // revealed only after close
  pointsAwarded: z.number().int().nonnegative(),
  runningScore: z.number().int().nonnegative(),
  ownRank: z.number().int().positive(),
});
export const QuizResultEvent = eventEnvelope('quiz.result', QuizResultPayload);
export type QuizResultEvent = z.infer<typeof QuizResultEvent>;

/** Machine 4b connection state (Z-12…Z-14). */
export const QuizParticipantPayload = z.object({
  participantId: Ulid,
  connectionState: ParticipantConnectionState,
});
export const QuizParticipantEvent = eventEnvelope('quiz.participant', QuizParticipantPayload);
export type QuizParticipantEvent = z.infer<typeof QuizParticipantEvent>;

/** Session closed (Z-15): student sees "session ended" + own final result. */
export const StudentQuizSessionPayload = z.object({
  state: z.enum(['open', 'closed']),
  finalScore: z.number().int().nonnegative().nullable(),
  finalRank: z.number().int().positive().nullable(),
});
export const StudentQuizSessionEvent = eventEnvelope(
  'quiz.session',
  StudentQuizSessionPayload,
);
export type StudentQuizSessionEvent = z.infer<typeof StudentQuizSessionEvent>;

export const StudentServerEvent = z.discriminatedUnion('event', [
  QuizQuestionEvent,
  QuizResultEvent,
  QuizParticipantEvent,
  StudentQuizSessionEvent,
]);
export type StudentServerEvent = z.infer<typeof StudentServerEvent>;

// ── 3. WebRTC preview signaling (A-17) — SEPARATE socket, /ws/preview ────────
// The event channel stays one-way; signaling is request/response by nature so
// it gets its own socket where client→server messages are allowed
// (target-architecture §2.1: "negotiated separately from the WS event channel").

export const PreviewClientMessage = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('offer'),
    negotiationId: Ulid, // client-minted per lightbox open
    roleId: SourceRoleId,
    sdp: z.string(),
  }),
  z.object({
    type: z.literal('ice'),
    negotiationId: Ulid,
    candidate: z.string(),
    sdpMid: z.string().nullable(),
    sdpMLineIndex: z.number().int().nullable(),
  }),
  z.object({
    type: z.literal('close'),
    negotiationId: Ulid,
  }),
]);
export type PreviewClientMessage = z.infer<typeof PreviewClientMessage>;

export const PreviewServerMessage = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('answer'),
    negotiationId: Ulid,
    sdp: z.string(),
  }),
  z.object({
    type: z.literal('ice'),
    negotiationId: Ulid,
    candidate: z.string(),
    sdpMid: z.string().nullable(),
    sdpMLineIndex: z.number().int().nullable(),
  }),
  z.object({
    type: z.literal('error'),
    negotiationId: Ulid,
    code: z.enum(['source-offline', 'source-unbound', 'busy', 'internal']),
    message: z.string(),
  }),
]);
export type PreviewServerMessage = z.infer<typeof PreviewServerMessage>;

// ── 4. Device ↔ quiz-service sync stream (DM-P5, machine 4d) ────────────────
// Device-initiated outbound WS to the quiz server (the public zone cannot dial
// into the campus LAN). Heartbeat every T-QUIZ-HEARTBEAT (5 s); silence beyond
// T-QUIZ-SYNC-STALE (15 s) ⇒ stale (Z-30).

/** Device → quiz-service on connect: watermark for idempotent replay (Z-31/Z-33). */
export const SyncHello = z.object({
  type: z.literal('sync.hello'),
  deviceId: Ulid,
  quizSessionId: Ulid,
  /** Highest AnswerSyncRecord.seq the device has durably stored; quiz-service replays everything above it. */
  answerWatermark: z.number().int().nonnegative(),
});
export type SyncHello = z.infer<typeof SyncHello>;

/** Quiz-service → device: answer batch (ordered by seq). */
export const SyncAnswers = z.object({
  type: z.literal('sync.answers'),
  quizSessionId: Ulid,
  answers: z.array(
    z.object({
      seq: z.number().int().positive(),
      answerId: Ulid,
      publicationId: Ulid,
      studentIdNumber: z.string().max(32),
      studentDisplayName: z.string().max(128),
      selectedOptionId: Ulid,
      isCorrect: z.boolean(),
      responseTimeMs: z.number().int().nonnegative(),
      submittedAt: Instant,
    }),
  ),
});
export type SyncAnswers = z.infer<typeof SyncAnswers>;

/** Quiz-service → device: joined/online counts (panel joined-count, G-4 denominator). */
export const SyncParticipants = z.object({
  type: z.literal('sync.participants'),
  quizSessionId: Ulid,
  joinedCount: z.number().int().nonnegative(),
  onlineCount: z.number().int().nonnegative(),
});
export type SyncParticipants = z.infer<typeof SyncParticipants>;

/** Both directions: liveness for machine 4d. */
export const SyncHeartbeat = z.object({
  type: z.literal('sync.heartbeat'),
  at: Instant,
});
export type SyncHeartbeat = z.infer<typeof SyncHeartbeat>;

export const QuizSyncServerMessage = z.discriminatedUnion('type', [
  SyncAnswers,
  SyncParticipants,
  SyncHeartbeat,
]);
export type QuizSyncServerMessage = z.infer<typeof QuizSyncServerMessage>;

export const QuizSyncClientMessage = z.discriminatedUnion('type', [
  SyncHello,
  SyncHeartbeat,
]);
export type QuizSyncClientMessage = z.infer<typeof QuizSyncClientMessage>;
