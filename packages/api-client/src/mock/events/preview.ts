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

interface Negotiation {
  readonly negotiationId: string;
  readonly roleId: SourceRoleId;
  stopFrames: (() => void) | null;
}

/**
 * events.md §3 — a dedicated signaling socket, separate from the one-way
 * event stream (`telemetry.ts`'s subject). One `PreviewChannel` per
 * `openPreview()` call; `<= 1` active negotiation per channel.
 *
 * V1 binds four `SourceRole`s (`machines/index.ts`'s `BOUND_SOURCE_ROLES`) —
 * `mic-room` is permanently unbound (INV-SR-2, A-08 amended) and has no
 * registered machine 5a instance at all, so `world.state()` would throw for
 * it; treat "not registered" the same as "not online" rather than letting
 * that throw escape this module.
 */
export function createPreviewChannel(world: MockWorld): PreviewChannel {
  const emitter = createEmitter<PreviewServerMessage>();
  let current: Negotiation | null = null;
  let closed = false;

  function isOnline(roleId: SourceRoleId): boolean {
    try {
      return world.state(`source:${roleId}`) === 'online';
    } catch {
      return false;
    }
  }

  function endCurrent(): void {
    current?.stopFrames?.();
    current = null;
  }

  function startFrames(negotiation: Negotiation): () => void {
    let seq = 0;
    let stopped = false;
    const tick = () => {
      if (stopped || closed) return;
      // MOCK-ONLY CONVENTION: the real §3 contract has no dedicated "frame"
      // message — actual preview video arrives over the negotiated WebRTC
      // `MediaStream`, entirely out of band from this signaling channel
      // (Wave 8 replaces this whole path). There is no real peer connection
      // here, so frames are pushed as `ice` messages instead, reusing its
      // opaque `candidate` string to carry each generated data URI. This
      // keeps the channel strictly typed as `EventStream<PreviewServerMessage>`
      // with no schema change and no cast.
      emitter.emit({
        type: 'ice',
        negotiationId: negotiation.negotiationId,
        candidate: generateFrame(negotiation.roleId, seq),
        sdpMid: null,
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

  function handleOffer(msg: Extract<PreviewClientMessage, { type: 'offer' }>): void {
    if (!isOnline(msg.roleId)) {
      emitter.emit({
        type: 'error',
        negotiationId: msg.negotiationId,
        code: 'source-offline',
        message: `source ${msg.roleId} is not online`,
      });
      return;
    }
    // A retried offer for the SAME negotiation that is already open/pending
    // is refused rather than restarted. A DIFFERENT negotiationId instead
    // implicitly supersedes the previous one (events.md §3's "<= 1 active
    // negotiation per connection; a new offer implicitly closes the
    // previous negotiation" — that is the branch below, not this one).
    if (current?.negotiationId === msg.negotiationId) {
      emitter.emit({
        type: 'error',
        negotiationId: msg.negotiationId,
        code: 'busy',
        message: `negotiation ${msg.negotiationId} is already open`,
      });
      return;
    }

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
      emitter.emit({
        type: 'answer',
        negotiationId: negotiation.negotiationId,
        sdp: fakeAnswerSdp(negotiation.roleId),
      });
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
      endCurrent();
    },
  };
}

function fakeAnswerSdp(roleId: SourceRoleId): string {
  return `v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=mock-preview:${roleId}\r\nt=0 0\r\n`;
}
