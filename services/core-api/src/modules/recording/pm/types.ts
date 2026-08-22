/**
 * Wire shapes for pipeline-manager's internal HTTP/SSE API
 * (docs/design/pipeline-manager.md §3), typed to match A-14's current
 * response bodies exactly — not the aspirational full status example in
 * §3.3. Nothing here is public v1 contract (openapi.yaml/events.md); it is
 * consumed only inside `modules/recording/pm/*`.
 */

export type PmPublisherId = 'usb' | 'rtsp' | 'rtsp2' | 'audio';
export type PmPublisherState = 'online' | 'degraded' | 'offline' | 'unknown';
export type PmConsumerState = 'starting' | 'running' | 'degraded' | 'stopping' | 'exited' | 'failed';
export type PmCaptureCardState = 'present' | 'absent' | 'recovering' | 'failed';

export interface PmPublisherStatus {
  state: PmPublisherState;
  bound: boolean;
  fps: number | null;
  rms: number | null;
  lastError: string | null;
}

export interface PmConsumerStatus {
  id: string;
  state: PmConsumerState;
  pgid: number | null;
}

/** `GET /status` — pipeline-manager.md §3.3, as A-14's `routes.py` `get_status` actually returns it. */
export interface PmStatus {
  platform: string;
  encodeLedger: { capacity: number; inUse: number; reservedBy: string[] };
  publishers: Record<PmPublisherId, PmPublisherStatus>;
  consumers: PmConsumerStatus[];
  device: { captureCardState: PmCaptureCardState; led: 'blink' | 'off' };
  sequence: number;
}

/** `GET /sources` — pipeline-manager.md §3.2 device/query row. */
export type PmSourcesStatus = Record<PmPublisherId, { roleId: string; state: PmConsumerState | PmPublisherState; bound: boolean }>;

/** One `202` command-accepted body shared by every consumer-start route. */
export interface PmCommandAccepted {
  consumerId: string;
  state: string;
}

export interface PmPublisherCommandAccepted {
  publisherId: string;
  state: string;
}

/** `PUT /audio/controls/mic-lecturer` (pipeline-manager.md §3.2) — always `200`; a mixer failure is `appliedState:'failed'`, never a thrown Problem (INV-AC-1, B-55's placebo). */
export interface PmAudioControlResult {
  roleId: string;
  appliedGain: number | null;
  appliedMuted: boolean | null;
  appliedState: 'applied' | 'failed';
  lastError: string | null;
}

/** `POST /consumers/projector` (pipeline-manager.md §3.2) — HDMI-out #1; a mode switch is not a restart (A-22). `correctOptionId` is present only for reveal mode (a re-projected `closed` publication, Q-36). */
export type PmProjectorRequest =
  | { mode: 'passthrough' }
  | {
      mode: 'question';
      questionPayload: {
        publicationId: string;
        prompt: string;
        options: Array<{ id: string; label: 'A' | 'B' | 'C' | 'D'; text: string }>;
        correctOptionId?: string;
        joinUrl: string | null;
        joinCode: string | null;
      };
    };

/** pipeline-manager.md §3.4 — the `{code, title, status, meta?}` body `app.py`'s exception handler emits. */
export interface PmProblem {
  code: string;
  title: string;
  status: number;
  meta?: Record<string, unknown>;
}

export class PipelineManagerError extends Error {
  readonly problem: PmProblem;

  constructor(problem: PmProblem) {
    super(problem.title);
    this.name = 'PipelineManagerError';
    this.problem = problem;
  }
}

/** One raw `id:`/`event:`/`data:` frame off `GET /events`, before dispatch. */
export interface PmSseFrame {
  id: number | null;
  event: string;
  data: unknown;
}

export interface PmConsumerRunningData {
  consumerId: string;
  pgid: number | null;
}

export interface PmConsumerFailedData {
  consumerId: string;
  code: string;
  meta?: Record<string, unknown>;
}

export interface PmConsumerEosData {
  consumerId: string;
}

export interface PmConsumerExitedData {
  consumerId: string;
  code: string;
}

/**
 * Typed union over the `evt.pm.*` kinds this bridge understands. Only
 * `consumer.running` and `resync-required` are ever actually published by
 * A's current runtime (the rest are the documented §3.4 async-failure
 * taxonomy A-15/A-16 board bring-up wires in) — the dispatcher decodes all
 * of them so B-05/B-06 have one stable internal shape to consume as that
 * wiring lands, without a B-side contract change.
 */
export type PmEvent =
  | { kind: 'evt.pm.consumer.running'; sequence: number; data: PmConsumerRunningData }
  | { kind: 'evt.pm.consumer.failed'; sequence: number; data: PmConsumerFailedData }
  | { kind: 'evt.pm.consumer.eos'; sequence: number; data: PmConsumerEosData }
  | { kind: 'evt.pm.consumer.exited'; sequence: number; data: PmConsumerExitedData }
  | { kind: 'evt.pm.resync-required'; sequence: number; data: Record<string, never> };

export const PM_RESYNC_EVENT_KIND = 'evt.pm.resync-required';

/** B-36 preview signaling (events.md §3) — internal `evt.pm.thumbnail.*` shapes A's worker protocol defines (`pipeline-manager.md` §A-06 stdout `answer|ice|error`) but does not yet publish over `/events` (ADR-022/CG-2, Wave-8 board work). Declared now so the dispatcher has one stable shape to decode as that wiring lands, same as `PmEvent` above. */
export interface PmThumbnailAnswerData {
  negotiationId: string;
  sdp: string;
}

export interface PmThumbnailIceData {
  negotiationId: string;
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
}

export interface PmThumbnailErrorData {
  negotiationId: string;
  code: string;
  message: string;
}

/**
 * KEEP B-56 gate correction (2026-08-18 flag, resolved) — the per-channel
 * effective encode profile B-24 resolves and hands to pipeline-manager's
 * `record`/`live` start bodies, already converted to the Bps units PM's
 * `get_profile(...)` overrides expect (`services/pipeline-manager/src/pipeline_manager/pipelines/profiles.py`).
 * Passthrough pipelines never receive this — B never attaches it there.
 */
export interface EffectiveEncodeProfile {
  videoBitrateBps: number;
  fps: number;
  gop: number;
  rateControl: 'cbr' | 'vbr';
  audioBitrateBps: number;
}
