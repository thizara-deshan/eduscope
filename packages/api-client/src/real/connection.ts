/**
 * The reconnect/staleness timer for the real panel socket (events.md §1,
 * DR-20). It is the SINGLE owner of the socket's timers: a reconnect backoff
 * timer and a staleness deadline. `panel-ws.ts` tells it what the socket just
 * did (`connecting`/`opened`/`lost`/`closed`); it publishes the resulting
 * `ConnectionStatus` and asks for a reconnect when the backoff elapses.
 *
 * Backoff is 0.5→10 s and then caps at 10 s indefinitely. Staleness is purely
 * time-based: 10 s continuously not-open. A token-refresh reconnect is
 * therefore not a stale error unless it, too, crosses the 10 s threshold.
 */
import type { ConnectionStatus } from '../stream.js';

export interface WsClock {
  setTimeout(handler: () => void, ms: number): number;
  clearTimeout(id: number): void;
  now(): number;
}

export const BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 10000] as const;
export const STALE_MS = 10_000;

export type LostReason = 'reconnect' | 'seq-gap';

export interface ConnectionMachine {
  connecting(): void;
  opened(): void;
  /** The socket went away; schedule a reconnect (0 ms delay if `immediate`). */
  lost(reason?: LostReason, immediate?: boolean): void;
  closed(): void;
  dispose(): void;
  readonly phase: ConnectionStatus['phase'];
}

export function createConnectionMachine(options: {
  clock: WsClock;
  reconnect: () => void;
  emit: (status: ConnectionStatus) => void;
}): ConnectionMachine {
  const { clock, reconnect, emit } = options;

  let phase: ConnectionStatus['phase'] = 'closed';
  let attempt = 0;
  let since = clock.now();
  let reconnectTimer: number | null = null;
  let staleTimer: number | null = null;

  const publish = (reason?: LostReason): void => {
    const status: ConnectionStatus = {
      phase,
      attempt,
      since: new Date(since).toISOString(),
      ...(reason ? { resyncReason: reason } : {}),
    };
    emit(status);
  };

  const clearReconnect = (): void => {
    if (reconnectTimer !== null) {
      clock.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };
  const clearStale = (): void => {
    if (staleTimer !== null) {
      clock.clearTimeout(staleTimer);
      staleTimer = null;
    }
  };

  /** Armed once at the first non-open moment; fires at a continuous 10 s. */
  const armStale = (): void => {
    if (staleTimer !== null) return;
    staleTimer = clock.setTimeout(() => {
      staleTimer = null;
      phase = 'stale';
      since = clock.now();
      publish();
    }, STALE_MS);
  };

  return {
    connecting() {
      // A reconnect attempt keeps the staleness clock running (it is only
      // reset on a real open), so do not touch `staleTimer` here.
      phase = 'connecting';
      since = clock.now();
      publish();
    },
    opened() {
      clearReconnect();
      clearStale();
      attempt = 0;
      phase = 'open';
      since = clock.now();
      publish();
    },
    lost(reason, immediate = false) {
      if (phase !== 'stale') phase = 'reconnecting';
      since = clock.now();
      armStale();
      const delay = immediate ? 0 : BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]!;
      attempt += 1;
      publish(reason);
      clearReconnect();
      reconnectTimer = clock.setTimeout(() => {
        reconnectTimer = null;
        reconnect();
      }, delay);
    },
    closed() {
      clearReconnect();
      clearStale();
      phase = 'closed';
      since = clock.now();
      publish();
    },
    dispose() {
      clearReconnect();
      clearStale();
    },
    get phase() {
      return phase;
    },
  };
}
