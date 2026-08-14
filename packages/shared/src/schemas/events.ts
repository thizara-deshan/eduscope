/**
 * Hand-authored mirror of contracts/events.md v0.3.0 — §2 panel/admin events,
 * §3 WebRTC preview signaling, §4 device<->quiz-server sync. Both the Phase-2
 * mock adapter and the Phase-4 backend validate against these.
 */
import { z } from 'zod';
import {
  zAiCountdownState,
  zCaptureCardState,
  zChannelId,
  zChannelRuntimeState,
  zExportJobState,
  zFirmwareUpdate,
  zLayoutPresetId,
  zLogEntry,
  zMergeState,
  zPublicationCloseReason,
  zProjectorState,
  zPublisherState,
  zQuestionSetState,
  zQuestionState,
  zQuizSessionProjectionState,
  zQuizSyncState,
  zRecordingWireState,
  zRetentionPolicy,
  zSegmentEndReason,
  zSegmentState,
  zSmartStatus,
  zSourceHealthState,
  zSourceRoleId,
  zStoragePressure,
  zSystemAlert,
  zUlid,
  zUploadFailureClass,
  zUploadFilePartState,
  zUploadJobState,
  zUsbVolume,
} from './rest.js';

// ── WS event envelope instant format: ISO 8601 with explicit offset ─────────
const zEventInstant = z.string().datetime({ offset: true });

// ── §2 payloads ────────────────────────────────────────────────────────────

/** §2.1 — startedAt/recordedDurationMs drive a LOCAL tick; no per-second events. */
export const zRecordingStatePayload = z.object({
  state: zRecordingWireState,
  startReason: z.enum(['initial', 'resume', 'recovery']).nullable(),
  sessionId: zUlid.nullable(),
  title: z.string().nullable(),
  ownerUserId: zUlid.nullable(),
  ownerDisplayName: z.string().nullable(),
  startedAt: zEventInstant.nullable(),
  recordedDurationMs: z.number().int().nonnegative().nullable(),
  segmentIndex: z.number().int().nonnegative().nullable(),
  segmentCount: z.number().int().nonnegative().nullable(),
  pauseCount: z.number().int().nonnegative().nullable(),
  takeoverBy: zUlid.nullable(),
  /** v0.3, CG-14 — set by R-21 alongside takeoverBy (S06-D-4). */
  takeoverAt: zEventInstant.nullable(),
  takeoverByDisplayName: z.string().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  adopted: z.boolean().optional(),
});

/** §2.2 */
export const zRecordingSegmentPayload = z.object({
  sessionId: zUlid,
  recordingId: zUlid,
  segmentId: zUlid,
  index: z.number().int().nonnegative(),
  state: zSegmentState,
  endReason: zSegmentEndReason.nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
});

/** §2.3 */
export const zRecordingArtifactPayload = z.object({
  recordingId: zUlid,
  sessionId: zUlid,
  state: z.enum(['capturing', 'finalizing', 'merging', 'ready', 'failed', 'deleted']),
  mergeState: zMergeState,
  durationMs: z.number().int().nonnegative().nullable(),
  totalBytes: z.number().int().nonnegative().nullable(),
  deleteReason: z.string().nullable(),
});

/** §2.4 */
export const zChannelStatePayload = z.object({
  channelId: zChannelId,
  state: zChannelRuntimeState,
  presetId: zLayoutPresetId,
  ratioA: z.number().int().nullable(),
  ratioB: z.number().int().nullable(),
  reason: z.string().nullable(),
});

/** §2.5 */
export const zSourcesStatusPayload = z.object({
  roleId: zSourceRoleId,
  state: zSourceHealthState,
  detail: z.string().nullable(),
  since: zEventInstant,
  inputId: zUlid.nullable(),
});

/** §2.6 — throttled to <= 10 Hz, panel connections only. Telemetry, never rows. */
export const zAudioLevelsPayload = z.object({
  roleId: zSourceRoleId,
  rms: z.number().min(0).max(1),
});

/** §2.7 — appliedState is the truth the UI shows (INV-AC-1). */
export const zAudioControlPayload = z.object({
  roleId: zSourceRoleId,
  gain: z.number().int().min(0).max(100),
  muted: z.boolean(),
  appliedState: z.enum(['applied', 'pending', 'failed']),
  lastError: z.string().nullable(),
});

/** §2.8 — carries the full policy so warning text quotes real values (INV-RP-1). */
export const zStorageStatusPayload = z.object({
  pressure: zStoragePressure,
  freeBytes: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  policy: zRetentionPolicy,
});

/** §2.9 */
export const zDeviceHealthPayload = z.object({
  captureCardState: zCaptureCardState,
  publisherStates: z.record(z.string(), zPublisherState),
  ntpSynced: z.boolean(),
  clockOffsetMs: z.number().int().nullable(),
  diskHealth: zSmartStatus,
  lastBootAt: zEventInstant,
});

/** §2.12 — nextAt is absolute; the panel ticks locally (INV-G-7). */
export const zAiCountdownPayload = z.object({
  state: zAiCountdownState,
  remainingMs: z.number().int().nonnegative().nullable(),
  nextAt: zEventInstant.nullable(),
  intervalMinutes: z.union([z.literal(10), z.literal(15), z.literal(20), z.literal(30)]),
});

/** §2.13 — supersedes ai.batch_ready; state `ready` IS batch-ready. */
export const zAiSetPayload = z.object({
  setId: zUlid,
  sessionId: zUlid,
  state: zQuestionSetState,
  trigger: z.enum(['countdown', 'manual']),
  count: z.number().int().nonnegative().nullable(),
  error: z.enum(['timeout', 'unreachable', 'invalid-payload']).nullable(),
  attempt: z.number().int().nonnegative(),
});

/** §2.14 — setId null = lecturer-authored ("Yours" chip). */
export const zAiQuestionPayload = z.object({
  questionId: zUlid,
  setId: zUlid.nullable(),
  state: zQuestionState,
  provenance: z.enum(['generated', 'lecturer-authored']),
  edited: z.boolean(),
});

/** §2.15 — `syncState` added by CG-19 (v0.4), mirroring `QuizSessionProjection.syncState`
 * so the joined-count staleness (Machine 4d, Z-30) is knowable live, not only on a
 * REST snapshot (INV-AP-2 / QZ-7). Non-nullable here: the events.md §2.15 field list
 * enumerates exactly `synced`/`stale`/`failed` and the emitter (4d) always holds a
 * concrete state — same as the sibling `zQuizPublicationPayload.syncState`. */
export const zQuizSessionPayload = z.object({
  state: zQuizSessionProjectionState,
  quizSessionId: zUlid.nullable(),
  joinUrl: z.string().nullable(),
  joinCode: z.string().nullable(),
  joinedCount: z.number().int().nonnegative(),
  syncState: zQuizSyncState,
});

/** §2.16 — exactly one publication may carry isShowing (INV-QPUB-1). */
export const zQuizPublicationPayload = z.object({
  publicationId: zUlid,
  questionId: zUlid,
  state: z.enum(['publishing', 'open', 'closed', 'failed']),
  isShowing: z.boolean(),
  projectorState: zProjectorState,
  syncState: zQuizSyncState,
  closeReason: zPublicationCloseReason.nullable(),
});

/** §2.17 — `stale` marks projections that must not be shown as current (INV-AP-2). */
export const zQuizResponsesPayload = z.object({
  publicationId: zUlid,
  deltas: z.array(
    z.object({
      studentIdNumber: z.string().max(32),
      displayName: z.string().max(128),
      selectedOptionId: zUlid,
      isCorrect: z.boolean(),
      responseTimeMs: z.number().int().nonnegative(),
      submittedAt: zEventInstant,
    }),
  ),
  syncedAt: zEventInstant,
  stale: z.boolean(),
});

/** §2.18 — `failureClass` added by CG-20 (v0.5), mirroring `UploadJob.failureClass`
 * so S-35 can distinguish an offline stall (`connectivity`, no attempts spent)
 * from a server failure (`server`, "attempt N of 8") live over the socket, not
 * only on a REST snapshot. Null unless `state ∈ {failed, dead-letter}` (§4.4);
 * parsing `lastError` for the class is forbidden (INV-RF-1). */
export const zUploadJobPayload = z.object({
  jobId: zUlid,
  recordingId: zUlid,
  state: zUploadJobState,
  attempt: z.number().int().nonnegative(),
  failureClass: zUploadFailureClass.nullable(),
  nextAttemptAt: zEventInstant.nullable(),
  progressPct: z.number().int().min(0).max(100),
  lastError: z.string().nullable(),
  blockedBy: z.string().nullable(),
});

/** §2.19 */
export const zUploadPartPayload = z.object({
  partId: zUlid,
  jobId: zUlid,
  streamKey: z.string(),
  state: zUploadFilePartState,
  bytesSent: z.number().int().nonnegative(),
  bytesTotal: z.number().int().nonnegative(),
});

/** §2.20 — real transfer bytes, never free-space arithmetic (INV-EX-1). */
export const zExportJobPayload = z.object({
  jobId: zUlid,
  state: zExportJobState,
  bytesCopied: z.number().int().nonnegative(),
  bytesTotal: z.number().int().nonnegative(),
  error: z.string().nullable(),
});

/** §2.21 — system and recordings volumes are never listed (INV-EX-2). */
export const zUsbVolumesPayload = z.object({ volumes: z.array(zUsbVolume) });

// ── §2 payload types ─────────────────────────────────────────────────────
// Named types for the schemas above — every zXPayload needs a bare XPayload
// so consumers (the WS store, Task 15) can type slices without re-deriving
// z.infer at every call site.
export type RecordingStatePayload = z.infer<typeof zRecordingStatePayload>;
export type RecordingSegmentPayload = z.infer<typeof zRecordingSegmentPayload>;
export type RecordingArtifactPayload = z.infer<typeof zRecordingArtifactPayload>;
export type ChannelStatePayload = z.infer<typeof zChannelStatePayload>;
export type SourcesStatusPayload = z.infer<typeof zSourcesStatusPayload>;
export type AudioLevelsPayload = z.infer<typeof zAudioLevelsPayload>;
export type AudioControlPayload = z.infer<typeof zAudioControlPayload>;
export type StorageStatusPayload = z.infer<typeof zStorageStatusPayload>;
export type DeviceHealthPayload = z.infer<typeof zDeviceHealthPayload>;
export type AiCountdownPayload = z.infer<typeof zAiCountdownPayload>;
export type AiSetPayload = z.infer<typeof zAiSetPayload>;
export type AiQuestionPayload = z.infer<typeof zAiQuestionPayload>;
export type QuizSessionPayload = z.infer<typeof zQuizSessionPayload>;
export type QuizPublicationPayload = z.infer<typeof zQuizPublicationPayload>;
export type QuizResponsesPayload = z.infer<typeof zQuizResponsesPayload>;
export type UploadJobPayload = z.infer<typeof zUploadJobPayload>;
export type UploadPartPayload = z.infer<typeof zUploadPartPayload>;
export type ExportJobPayload = z.infer<typeof zExportJobPayload>;
export type UsbVolumesPayload = z.infer<typeof zUsbVolumesPayload>;

// ── §2 union ───────────────────────────────────────────────────────────────

export const zPanelServerEvent = z.discriminatedUnion('event', [
  z.object({ event: z.literal('recording.state'), payload: zRecordingStatePayload }),
  z.object({ event: z.literal('recording.segment'), payload: zRecordingSegmentPayload }),
  z.object({ event: z.literal('recording.artifact'), payload: zRecordingArtifactPayload }),
  z.object({ event: z.literal('channel.state'), payload: zChannelStatePayload }),
  z.object({ event: z.literal('sources.status'), payload: zSourcesStatusPayload }),
  z.object({ event: z.literal('audio.levels'), payload: zAudioLevelsPayload }),
  z.object({ event: z.literal('audio.control'), payload: zAudioControlPayload }),
  z.object({ event: z.literal('storage.status'), payload: zStorageStatusPayload }),
  z.object({ event: z.literal('device.health'), payload: zDeviceHealthPayload }),
  z.object({ event: z.literal('system.alert'), payload: zSystemAlert }),
  z.object({ event: z.literal('log.entry'), payload: zLogEntry }),
  z.object({ event: z.literal('ai.countdown'), payload: zAiCountdownPayload }),
  z.object({ event: z.literal('ai.set'), payload: zAiSetPayload }),
  z.object({ event: z.literal('ai.question'), payload: zAiQuestionPayload }),
  z.object({ event: z.literal('quiz.session'), payload: zQuizSessionPayload }),
  z.object({ event: z.literal('quiz.publication'), payload: zQuizPublicationPayload }),
  z.object({ event: z.literal('quiz.responses'), payload: zQuizResponsesPayload }),
  z.object({ event: z.literal('upload.job'), payload: zUploadJobPayload }),
  z.object({ event: z.literal('upload.part'), payload: zUploadPartPayload }),
  z.object({ event: z.literal('export.job'), payload: zExportJobPayload }),
  z.object({ event: z.literal('usb.volumes'), payload: zUsbVolumesPayload }),
  z.object({ event: z.literal('firmware.state'), payload: zFirmwareUpdate }),
]);

export type PanelServerEvent = z.infer<typeof zPanelServerEvent>;
export type PanelEventName = PanelServerEvent['event'];

/** The closed catalog. Anything not here does not exist (state-machines SM-R-3). */
export const PANEL_EVENT_NAMES = [
  'recording.state',
  'recording.segment',
  'recording.artifact',
  'channel.state',
  'sources.status',
  'audio.levels',
  'audio.control',
  'storage.status',
  'device.health',
  'system.alert',
  'log.entry',
  'ai.countdown',
  'ai.set',
  'ai.question',
  'quiz.session',
  'quiz.publication',
  'quiz.responses',
  'upload.job',
  'upload.part',
  'export.job',
  'usb.volumes',
  'firmware.state',
] as const satisfies readonly PanelEventName[];

/** §1 envelope: `seq` is per-connection and monotonic; a gap forces a full resync. */
export const zEventEnvelope = zPanelServerEvent.and(
  z.object({ at: zEventInstant, seq: z.number().int().nonnegative() }),
);
export type EventEnvelope = z.infer<typeof zEventEnvelope>;

// ── §3 WebRTC preview signaling (separate socket, no seq) ───────────────────

export const zPreviewClientMessage = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('offer'),
    negotiationId: zUlid,
    roleId: zSourceRoleId,
    sdp: z.string(),
  }),
  z.object({
    type: z.literal('ice'),
    negotiationId: zUlid,
    candidate: z.string(),
    sdpMid: z.string().nullable(),
    sdpMLineIndex: z.number().int().nullable(),
  }),
  z.object({ type: z.literal('close'), negotiationId: zUlid }),
]);

export const zPreviewServerMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('answer'), negotiationId: zUlid, sdp: z.string() }),
  z.object({
    type: z.literal('ice'),
    negotiationId: zUlid,
    candidate: z.string(),
    sdpMid: z.string().nullable(),
    sdpMLineIndex: z.number().int().nullable(),
  }),
  z.object({
    type: z.literal('error'),
    negotiationId: zUlid,
    code: z.enum(['source-offline', 'source-unbound', 'busy', 'internal']),
    message: z.string(),
  }),
]);

export type PreviewClientMessage = z.infer<typeof zPreviewClientMessage>;
export type PreviewServerMessage = z.infer<typeof zPreviewServerMessage>;

// ── §4 device <-> quiz-server sync stream ──────────────────────────────────

export const zQuizSyncClientMessage = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('sync.hello'),
    deviceId: zUlid,
    quizSessionId: zUlid,
    answerWatermark: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal('sync.heartbeat'), at: zEventInstant }),
]);

export const zQuizSyncServerMessage = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('sync.answers'),
    quizSessionId: zUlid,
    answers: z.array(
      z.object({
        seq: z.number().int().nonnegative(),
        answerId: zUlid,
        publicationId: zUlid,
        studentIdNumber: z.string().max(32),
        studentDisplayName: z.string().max(128),
        selectedOptionId: zUlid,
        isCorrect: z.boolean(),
        responseTimeMs: z.number().int().nonnegative(),
        submittedAt: zEventInstant,
      }),
    ),
  }),
  z.object({
    type: z.literal('sync.participants'),
    quizSessionId: zUlid,
    joinedCount: z.number().int().nonnegative(),
    onlineCount: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal('sync.heartbeat'), at: zEventInstant }),
]);

// ── §5 student realtime, shared with apps/quiz (added contract v0.6) ────────

export const zStudentQuizOption = z.object({
  id: zUlid,
  label: z.string(),
  text: z.string(),
}).strict();

export const zStudentQuizQuestionPayload = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('open'),
    publicationId: zUlid,
    prompt: z.string(),
    options: z.array(zStudentQuizOption).min(2).max(4),
    ownAnswerOptionId: zUlid.nullable(),
  }).strict(),
  z.object({
    state: z.literal('closed'),
    publicationId: zUlid,
    prompt: z.string(),
    options: z.array(zStudentQuizOption).min(2).max(4),
    ownAnswerOptionId: zUlid.nullable(),
  }).strict(),
  z.object({ state: z.literal('none') }).strict(),
]);

export const zStudentQuizResultPayload = z.object({
  publicationId: zUlid,
  question: z.object({
    prompt: z.string(),
    options: z.array(zStudentQuizOption).min(2).max(4),
  }).strict(),
  selectedOptionId: zUlid.nullable(),
  isCorrect: z.boolean().nullable(),
  correctOptionId: zUlid,
  pointsAwarded: z.number().int().nonnegative(),
  runningScore: z.number().int().nonnegative(),
  ownRank: z.number().int().nonnegative().nullable(),
  rankState: z.enum(['pending', 'current']),
}).strict();

export const zStudentQuizSessionPayload = z.union([
  z.object({
    state: z.literal('open'),
    finalScore: z.null().optional(),
    finalRank: z.null().optional(),
    answeredCount: z.null().optional(),
  }).strict(),
  z.discriminatedUnion('participationState', [
    z.object({
      state: z.literal('closed'),
      participationState: z.literal('participated'),
      finalScore: z.number().int().nonnegative(),
      finalRank: z.number().int().nonnegative(),
      answeredCount: z.number().int().positive(),
    }).strict(),
    z.object({
      state: z.literal('closed'),
      participationState: z.literal('none'),
      finalScore: z.literal(0),
      finalRank: z.null(),
      answeredCount: z.literal(0),
    }).strict(),
  ]),
]);

export const zStudentServerEvent = z.discriminatedUnion('event', [
  z.object({
    event: z.literal('quiz.question'),
    payload: zStudentQuizQuestionPayload,
  }),
  z.object({
    event: z.literal('quiz.result'),
    payload: zStudentQuizResultPayload,
  }),
  z.object({
    event: z.literal('quiz.participant'),
    payload: z.object({ connectionState: z.enum(['online', 'offline']) }),
  }),
  z.object({
    event: z.literal('quiz.session'),
    payload: zStudentQuizSessionPayload,
  }),
]);

export type StudentQuizOption = z.infer<typeof zStudentQuizOption>;
export type StudentQuizQuestionPayload = z.infer<typeof zStudentQuizQuestionPayload>;
export type StudentQuizResultPayload = z.infer<typeof zStudentQuizResultPayload>;
export type StudentQuizSessionPayload = z.infer<typeof zStudentQuizSessionPayload>;
export type StudentServerEvent = z.infer<typeof zStudentServerEvent>;
