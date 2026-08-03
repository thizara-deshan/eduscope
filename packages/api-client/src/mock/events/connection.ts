import { TIMERS, WS_RECONNECT_BACKOFF_MS } from '@eduscope/shared';
import { createEmitter, type ConnectionStatus, type EventStream } from '../../stream.js';
import type { ScenarioScript } from '../scenario/types.js';
import type { MockWorld } from '../world.js';

export interface ConnectionController {
  readonly connection$: EventStream<ConnectionStatus>;
  start(): void;
  stop(): void;
}

/**
 * events.md §1 — the event-socket lifecycle: `connecting -> open`, and, only
 * when `script.wsFlap` is set (the `ws-flap` scenario), a drop/reconnect
 * cycle repeated `script.wsFlap.repeat` times: `open -> reconnecting ->
 * stale -> open`, each restore forcing a **full** snapshot replay (never a
 * partial patch).
 *
 * `resyncReason: 'seq-gap'` is part of `ConnectionStatus` (`stream.ts`) but
 * is not produced here: a seq gap is something a *consumer* of `events$`
 * detects client-side and reacts to via `EduscopeClient.resync()`
 * (Task 12), not something this socket-lifecycle module manufactures on its
 * own. This module only drives the `'reconnect'` resync the wsFlap script
 * describes.
 */
export function createConnectionController(
  world: MockWorld,
  script: ScenarioScript,
): ConnectionController {
  const emitter = createEmitter<ConnectionStatus>();
  let stopped = true;

  function set(phase: ConnectionStatus['phase'], attempt: number, resyncReason?: ConnectionStatus['resyncReason']): void {
    if (stopped) return;
    emitter.emit({
      phase,
      attempt,
      since: world.clock.nowIso(),
      ...(resyncReason ? { resyncReason } : {}),
    });
  }

  /** events.md §1: never a partial patch — replay every `latest` event again. */
  function replaySnapshot(): void {
    for (const envelope of world.snapshot()) {
      world.emit(envelope.event, envelope.payload);
    }
  }

  function dropSocket(downMs: number, onRestored: () => void): void {
    let attempt = 0;

    const emitReconnecting = () => {
      attempt += 1;
      set('reconnecting', attempt);
    };
    emitReconnecting(); // the socket just dropped — the first attempt fires immediately

    let elapsed = 0;
    let step = 0;
    const lastBackoffMs = WS_RECONNECT_BACKOFF_MS[WS_RECONNECT_BACKOFF_MS.length - 1] ?? 10_000;
    const scheduleNext = () => {
      const wait = WS_RECONNECT_BACKOFF_MS[step] ?? lastBackoffMs;
      step += 1;
      elapsed += wait;
      if (elapsed >= downMs) return; // no more attempts fit before the socket restores
      world.clock.setTimeout(() => {
        if (stopped) return;
        emitReconnecting();
        scheduleNext();
      }, wait);
    };
    scheduleNext();

    if (downMs > TIMERS['T-WS-STALE']) {
      world.clock.setTimeout(() => {
        if (stopped) return;
        set('stale', attempt);
      }, TIMERS['T-WS-STALE']);
    }

    world.clock.setTimeout(() => {
      if (stopped) return;
      set('open', attempt, 'reconnect');
      replaySnapshot();
      onRestored();
    }, downMs);
  }

  function runFlapCycles(remaining: number, afterMs: number, downMs: number): void {
    if (stopped || remaining <= 0) return;
    world.clock.setTimeout(() => {
      if (stopped) return;
      dropSocket(downMs, () => runFlapCycles(remaining - 1, afterMs, downMs));
    }, afterMs);
  }

  return {
    connection$: emitter,

    start() {
      stopped = false;
      set('connecting', 0);
      // The mock's first connect never fails — go straight to `open`.
      set('open', 0);
      if (script.wsFlap) {
        runFlapCycles(script.wsFlap.repeat, script.wsFlap.afterMs, script.wsFlap.downMs);
      }
    },

    stop() {
      stopped = true;
    },
  };
}
