import { CONSUMER_RESTART_BACKOFF_MS } from '@eduscope/shared';
import type { Clock } from '../../../lib/clock.js';
import { DomainBus } from '../../../lib/domain-bus.js';
import type { LifecycleComponent, LifecycleStopReason } from '../../../lifecycle.js';
import { ReconnectBackoff } from '../../../lib/reconnect.js';
import type { PipelineManagerClient } from './client.js';
import { parseSseStream } from './sse.js';
import {
  PM_RESYNC_EVENT_KIND,
  type PmConsumerEosData,
  type PmConsumerExitedData,
  type PmConsumerFailedData,
  type PmConsumerRunningData,
  type PmSseFrame,
  type PmStatus,
} from './types.js';

export interface PipelineManagerBridgeLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

export interface PipelineManagerBridgeDeps {
  client: PipelineManagerClient;
  bus: DomainBus;
  clock: Clock;
  logger?: PipelineManagerBridgeLogger;
}

type ConsumeOutcome = 'stream-ended' | 'resync-required';

/** Decodes one raw SSE frame into a typed bus publish call, or `null` for an unknown/malformed frame. */
function dispatchFrame(frame: PmSseFrame, bus: DomainBus): void {
  const data = frame.data;
  if (typeof data !== 'object' || data === null) return;

  switch (frame.event) {
    case 'evt.pm.consumer.running':
      bus.publish('evt.pm.consumer.running', data as PmConsumerRunningData);
      return;
    case 'evt.pm.consumer.failed':
      bus.publish('evt.pm.consumer.failed', data as PmConsumerFailedData);
      return;
    case 'evt.pm.consumer.eos':
      bus.publish('evt.pm.consumer.eos', data as PmConsumerEosData);
      return;
    case 'evt.pm.consumer.exited':
      bus.publish('evt.pm.consumer.exited', data as PmConsumerExitedData);
      return;
    default:
      return; // forward-compatible: an event kind this bridge doesn't yet know is silently ignored, never crashes the stream
  }
}

/**
 * Owns the single pipeline-manager SSE connection (design/core-api.md §4.1,
 * "one SSE connection, one dispatcher, two consumers"). Publishes typed
 * internal domain events only — never a public WS payload directly. On
 * connect, reconnect, or a server-declared gap it re-reads `GET /status`
 * before resuming deltas, so a consumer never observes a stale projection.
 */
export class PipelineManagerBridge implements LifecycleComponent {
  readonly name = 'pm-bridge';

  readonly #client: PipelineManagerClient;
  readonly #bus: DomainBus;
  readonly #clock: Clock;
  readonly #logger: PipelineManagerBridgeLogger | undefined;
  readonly #backoff = new ReconnectBackoff(CONSUMER_RESTART_BACKOFF_MS);

  #abortController: AbortController | null = null;
  #loopPromise: Promise<void> | null = null;
  #lastSequence = 0;

  constructor(deps: PipelineManagerBridgeDeps) {
    this.#client = deps.client;
    this.#bus = deps.bus;
    this.#clock = deps.clock;
    this.#logger = deps.logger;
  }

  async start(): Promise<void> {
    const controller = new AbortController();
    this.#abortController = controller;
    this.#loopPromise = this.#runLoop(controller.signal);
  }

  /** Aborts the SSE connection and any pending reconnect wait; issues no PM consumer stop (B-04 lifecycle table). */
  async stop(_reason: LifecycleStopReason): Promise<void> {
    this.#abortController?.abort();
    await this.#loopPromise?.catch(() => undefined);
    this.#loopPromise = null;
  }

  async #runLoop(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      let needsBackoff = false;
      try {
        const status = await this.#resync(signal);
        this.#backoff.reset();
        const outcome = await this.#consumeEvents(signal);
        if (outcome === 'resync-required') {
          // The server can't replay from our watermark (buffer eviction, or a
          // very first connect against a long-lived PM). Consumers were
          // already told to treat state as unknown by the status publish
          // above; jump the watermark to it so the next connect asks for a
          // replay window the server can actually satisfy, instead of
          // looping on the same unreplayable id forever.
          this.#lastSequence = status.sequence;
        } else if (outcome === 'stream-ended') {
          needsBackoff = true;
        }
      } catch (error) {
        if (signal.aborted) return;
        this.#logger?.warn('pm-bridge connection error', { error: this.#describeError(error) });
        needsBackoff = true;
      }

      if (signal.aborted) return;
      if (needsBackoff) {
        await this.#clock.sleep(this.#backoff.next(), signal);
      }
    }
  }

  /** Forced full-snapshot read on every connect and reconnect (B-04 plan Step 1/3). Does not itself move the replay watermark — see the resync-required handling above for the one case it must. */
  async #resync(signal: AbortSignal): Promise<PmStatus> {
    const status = await this.#client.getStatus(signal);
    this.#bus.publish('pm.status.resynced', status);
    return status;
  }

  async #consumeEvents(signal: AbortSignal): Promise<ConsumeOutcome> {
    const response = await this.#client.openEventStream(this.#lastSequence, signal);
    if (!response.body) return 'stream-ended';

    for await (const frame of parseSseStream(response.body, signal)) {
      if (frame.event === PM_RESYNC_EVENT_KIND) {
        return 'resync-required';
      }
      this.#applyFrame(frame);
    }
    return 'stream-ended';
  }

  /** Monotonic `seq` application (state-machines.md §0.1 `evt.x.y`) — an id at or below the last applied sequence is a duplicate and is dropped. */
  #applyFrame(frame: PmSseFrame): void {
    if (frame.id !== null) {
      if (frame.id <= this.#lastSequence) return;
      this.#lastSequence = frame.id;
    }
    dispatchFrame(frame, this.#bus);
  }

  #describeError(error: unknown): string {
    // Never includes the bearer: PipelineManagerError carries only {code,title,status,meta}, and fetch/AbortError messages never echo request headers.
    return error instanceof Error ? error.message : String(error);
  }
}
