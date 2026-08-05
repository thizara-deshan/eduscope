import type { PreviewClientMessage, PreviewServerMessage, SourceRoleId } from '@eduscope/shared';
import type { PreviewChannel } from '../../client.js';
import { createEmitter } from '../../stream.js';
import type { MockWorld } from '../world.js';
import { generateFrame } from './telemetry.js';

/** INT-8: preview visible < 1 s from tap — 300 ms leaves headroom for the panel's own render. */
const ANSWER_DELAY_MS = 300;

/** Cost note (telemetry.ts): 8 fps, not 12 — bounded RK3588 budget, one lightbox at a time. */
const PREVIEW_FPS = 8;
const PREVIEW_PERIOD_MS = 1_000 / PREVIEW_FPS;

/**
 * MOCK-ONLY CONVENTION: the real §3 contract has no dedicated "frame"
 * message — actual preview video arrives over the negotiated WebRTC
 * `MediaStream`, entirely out of band from this signaling channel (Wave 8
 * replaces this whole path). There is no real peer connection here, so
 * frames are pushed as `ice` messages instead, reusing its opaque
 * `candidate` string to carry each generated data URI. This keeps the
 * channel strictly typed as `EventStream<PreviewServerMessage>` with no
 * schema change and no cast. `sdpMid` is stamped with this sentinel (instead
 * of `null`, which a real trickle-ICE candidate would also use) purely so a
 * mock frame is distinguishable at runtime from a genuine ICE candidate —
 * see `isMockPreviewFrame` below.
 */
const MOCK_FRAME_SDP_MID = 'mock-frame';

/** True for a `PreviewServerMessage` that is actually a mock JPEG frame smuggled over `ice` (see `MOCK_FRAME_SDP_MID`). */
export function isMockPreviewFrame(
  msg: PreviewServerMessage,
): msg is Extract<PreviewServerMessage, { type: 'ice' }> {
  return msg.type === 'ice' && msg.sdpMid === MOCK_FRAME_SDP_MID;
}

interface Negotiation {
  readonly negotiationId: string;
  readonly roleId: SourceRoleId;
  stopFrames: (() => void) | null;
}

/**
 * events.md §3 — a dedicated signaling socket, separate from the one-way
 * event stream (`telemetry.ts`'s subject). One `PreviewChannel` per
 * `openPreview()` call; `<= 1` active negotiation per channel.
 */
export function createPreviewChannel(world: MockWorld): PreviewChannel {
  const emitter = createEmitter<PreviewServerMessage>();
  let current: Negotiation | null = null;
  let closed = false;

  /**
   * V1 binds four `SourceRole`s (`machines/index.ts`'s `BOUND_SOURCE_ROLES`)
   * — `mic-room` is permanently unbound (INV-SR-2, A-08 amended) and has no
   * registered machine 5a instance at all, so `world.state()` throws for it.
   * That "not registered" case, and an explicit `state === 'unbound'`, both
   * map to the contract's dedicated `source-unbound` code; a *registered*
   * role that just isn't `online` yet (offline/unknown/degraded) maps to
   * `source-offline` instead — these are two different codes for a reason,
   * do not collapse them into one.
   */
  function sourceErrorCode(roleId: SourceRoleId): 'source-unbound' | 'source-offline' | null {
    let state: string;
    try {
      state = world.state(`source:${roleId}`);
    } catch {
      return 'source-unbound';
    }
    if (state === 'unbound') return 'source-unbound';
    if (state === 'online') return null;
    return 'source-offline';
  }

  function endCurrent(): void {
    current?.stopFrames?.();
    current = null;
  }

  /**
   * S-10 `source went offline mid-preview`: "the server drops unilaterally; the
   * lightbox shows why rather than freezing on the last frame." Nothing did
   * that — the frame loop kept painting a source the world had already marked
   * offline, which is the B-12 class in miniature.
   */
  const unsubscribe = world.subscribeEvents((envelope) => {
    if (envelope.event !== 'sources.status' || !current) return;
    const payload = envelope.payload as { roleId: string; state: string };
    if (payload.roleId !== current.roleId || payload.state === 'online') return;
    const dying = current;
    endCurrent();
    emitter.emit({
      type: 'error',
      negotiationId: dying.negotiationId,
      code: payload.state === 'unbound' ? 'source-unbound' : 'source-offline',
      message: `source ${dying.roleId} is no longer available`,
    });
  });

  function startFrames(negotiation: Negotiation): () => void {
    let seq = 0;
    let stopped = false;
    const tick = () => {
      if (stopped || closed) return;
      emitter.emit({
        type: 'ice',
        negotiationId: negotiation.negotiationId,
        candidate: generateFrame(negotiation.roleId, seq),
        sdpMid: MOCK_FRAME_SDP_MID,
        sdpMLineIndex: null,
      });
      seq += 1;
      world.clock.setTimeout(tick, PREVIEW_PERIOD_MS);
    };
    world.clock.setTimeout(tick, PREVIEW_PERIOD_MS);
    return () => {
      stopped = true;
    };
  }

  function sendAnswer(negotiation: Negotiation): void {
    emitter.emit({
      type: 'answer',
      negotiationId: negotiation.negotiationId,
      sdp: fakeAnswerSdp(negotiation.roleId),
    });
  }

  function handleOffer(msg: Extract<PreviewClientMessage, { type: 'offer' }>): void {
    const errorCode = sourceErrorCode(msg.roleId);
    if (errorCode) {
      emitter.emit({
        type: 'error',
        negotiationId: msg.negotiationId,
        code: errorCode,
        message:
          errorCode === 'source-unbound'
            ? `source ${msg.roleId} has no physical input bound`
            : `source ${msg.roleId} is not online`,
      });
      return;
    }

    // A re-offer of the SAME negotiationId is treated as idempotent, never
    // as an error: events.md §3 says `error` is "terminal per negotiation",
    // and this negotiation is still alive (still streaming, or still
    // waiting on its first answer) — emitting `error{code:'busy'}` here
    // would be a contract violation (a terminal error for a live
    // negotiation). In the documented flow this path is close to
    // unreachable anyway: a real client mints a fresh negotiationId per
    // lightbox open.
    if (current?.negotiationId === msg.negotiationId) {
      if (current.stopFrames) sendAnswer(current); // already answered — ack again, no-op otherwise
      return;
    }

    // events.md §3: <= 1 active negotiation per connection; a new offer
    // (a genuinely different negotiationId) implicitly closes the previous
    // one rather than erroring.
    endCurrent();
    const negotiation: Negotiation = {
      negotiationId: msg.negotiationId,
      roleId: msg.roleId,
      stopFrames: null,
    };
    current = negotiation;
    world.clock.setTimeout(() => {
      // The channel may have been closed, or superseded by a newer offer,
      // while this answer was in flight — do not resurrect a dead negotiation.
      if (closed || current !== negotiation) return;
      sendAnswer(negotiation);
      negotiation.stopFrames = startFrames(negotiation);
    }, ANSWER_DELAY_MS);
  }

  return {
    send(message: PreviewClientMessage) {
      if (closed) return;
      switch (message.type) {
        case 'offer':
          handleOffer(message);
          return;
        case 'close':
          // Preview death never touches recording (machine 1a) — this
          // module only ever stops the local frame loop.
          if (current?.negotiationId === message.negotiationId) endCurrent();
          return;
        case 'ice':
          // Trickle ICE from a real client has nowhere to go — there is no
          // real RTCPeerConnection behind this mock. Silently accepted.
          return;
      }
    },
    messages$: emitter,
    close() {
      closed = true;
      unsubscribe();
      endCurrent();
    },
  };
}

function fakeAnswerSdp(roleId: SourceRoleId): string {
  return `v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=mock-preview:${roleId}\r\nt=0 0\r\n`;
}
