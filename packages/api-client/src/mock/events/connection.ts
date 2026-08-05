import { TIMERS, WS_RECONNECT_BACKOFF_MS } from '@eduscope/shared';
import { createEmitter, type ConnectionStatus, type EventStream } from '../../stream.js';
import type { ScenarioScript } from '../scenario/types.js';
import type { MockWorld } from '../world.js';

export interface ConnectionController {
  readonly connection$: EventStream<ConnectionStatus>;
  start(): void;
  stop(): void;
  /**
   * v0.3, CG-16 — a successful `powerOffDevice` has no resolving event; the
   * transport closing (and staying closed, unlike `wsFlap`'s drop/restore
   * cycle) IS the resolution (S12-D-2). Generation-guarded like every other
   * scheduled phase change here, so a `switchScenario` mid-shutdown does not
   * leave a stray `closed` emission targeting the next scenario's world.
   */
  closeForShutdown(afterMs: number): void;
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
 *
 * `Clock.setTimeout` has no bulk-cancel, and this module schedules a
 * variable, data-dependent number of callbacks per `start()` (the backoff
 * ladder's length depends on `downMs`), so rather than collecting every
 * handle to `clearTimeout` individually, each `start()` mints a fresh
 * `generation`. Every callback this module schedules captures that
 * generation and no-ops if `generation` has since moved on (a later
 * `stop()` or `start()`) by the time it fires — the same effect as
 * cancelling every pending timer, without the handle bookkeeping. Without
 * this, a `stop()`/`start()` cycle would leave the old session's timers
 * alive, injecting phantom `stale`/`open`+resync events into the new one.
 */
export function createConnectionController(
  world: MockWorld,
  script: ScenarioScript,
): ConnectionController {
  const emitter = createEmitter<ConnectionStatus>();
  let generation = 0;
  let running = false;

  function set(
    gen: number,
    phase: ConnectionStatus['phase'],
    attempt: number,
    resyncReason?: ConnectionStatus['resyncReason'],
  ): void {
    if (gen !== generation || !running) return;
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

  function dropSocket(gen: number, downMs: number, onRestored: () => void): void {
    let attempt = 0;

    const emitReconnecting = () => {
      attempt += 1;
      set(gen, 'reconnecting', attempt);
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
        if (gen !== generation) return;
        emitReconnecting();
        scheduleNext();
      }, wait);
    };
    scheduleNext();

    if (downMs > TIMERS['T-WS-STALE']) {
      world.clock.setTimeout(() => {
        set(gen, 'stale', attempt);
      }, TIMERS['T-WS-STALE']);
    }

    world.clock.setTimeout(() => {
      if (gen !== generation) return;
      set(gen, 'open', attempt, 'reconnect');
      replaySnapshot();
      onRestored();
    }, downMs);
  }

  function runFlapCycles(gen: number, remaining: number, afterMs: number, downMs: number): void {
    if (remaining <= 0) return;
    world.clock.setTimeout(() => {
      if (gen !== generation) return;
      dropSocket(gen, downMs, () => runFlapCycles(gen, remaining - 1, afterMs, downMs));
    }, afterMs);
  }

  return {
    connection$: emitter,

    start() {
      generation += 1;
      const gen = generation;
      running = true;
      set(gen, 'connecting', 0);
      // The mock's first connect never fails — go straight to `open`.
      set(gen, 'open', 0);
      if (script.wsFlap) {
        runFlapCycles(gen, script.wsFlap.repeat, script.wsFlap.afterMs, script.wsFlap.downMs);
      }
    },

    stop() {
      running = false;
      generation += 1; // invalidate every callback scheduled by this session
    },

    closeForShutdown(afterMs) {
      const gen = generation;
      world.clock.setTimeout(() => {
        set(gen, 'closed', 0);
      }, afterMs);
    },
  };
}
