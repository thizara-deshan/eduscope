/**
 * The real panel realtime socket (events.md §1, DR-05/DR-20).
 *
 * - Auth is the DR-05 subprotocol: `new WebSocket(url, [accessToken])`. The JWT
 *   never appears in the URL (it would land in access logs).
 * - Every frame is validated with `zEventEnvelope`; an unparseable or invalid
 *   frame closes the socket 1008 (policy violation) and reconnects.
 * - `seq` starts at any value but must then be contiguous; a gap does NOT patch
 *   — it emits `resyncReason:'seq-gap'` and reconnects for a fresh subscribe
 *   snapshot (the store reset is the consumer's job).
 * - The socket connects lazily on the first `events$`/`connection$` subscriber
 *   once a token exists, reconnects on token rotation, and never queues a command.
 */
import { zEventEnvelope, type EventEnvelope } from '@eduscope/shared';
import {
  createEmitter,
  type ConnectionStatus,
  type EventStream,
  type Unsubscribe,
} from '../stream.js';
import { createConnectionMachine, type WsClock } from './connection.js';
import type { TokenStore } from './auth.js';

export interface PanelWebSocketLike {
  onopen: ((event?: unknown) => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: ((event?: unknown) => void) | null;
  close(code?: number, reason?: string): void;
  readonly readyState: number;
}
export type PanelWebSocketFactory = (
  url: string,
  protocols: string[],
) => PanelWebSocketLike;

export interface PanelSocket {
  readonly events$: EventStream<EventEnvelope>;
  readonly connection$: EventStream<ConnectionStatus>;
  /** Force a full-snapshot re-subscribe (a `seq` gap demands it). */
  resync(): Promise<void>;
  dispose(): void;
}

const POLICY_VIOLATION = 1008;

export function panelWsUrl(apiBaseUrl: string): string {
  let url = apiBaseUrl;
  if (url.startsWith('https:')) url = `wss:${url.slice('https:'.length)}`;
  else if (url.startsWith('http:')) url = `ws:${url.slice('http:'.length)}`;
  else if (url.startsWith('//')) url = `ws:${url}`;
  else if (url.startsWith('/')) {
    const origin = (globalThis as { location?: { origin?: string } }).location?.origin ?? '';
    url = `${origin.replace(/^http/, 'ws')}${url}`;
  }
  return `${url.replace(/\/+$/, '')}/ws`;
}

export function createPanelSocket(options: {
  apiBaseUrl: string;
  tokenStore: TokenStore;
  webSocket: PanelWebSocketFactory;
  clock: WsClock;
}): PanelSocket {
  const { apiBaseUrl, tokenStore, webSocket, clock } = options;

  const events = createEmitter<EventEnvelope>();
  const connectionListeners = new Set<(status: ConnectionStatus) => void>();
  let lastStatus: ConnectionStatus | undefined;

  const emitConnection = (status: ConnectionStatus): void => {
    lastStatus = status;
    for (const listener of [...connectionListeners]) listener(status);
  };

  let socket: PanelWebSocketLike | null = null;
  let currentToken: string | null = null;
  let lastSeq: number | null = null;
  let disposed = false;
  let subscribers = 0;
  let pending: { reason: 'reconnect' | 'seq-gap'; immediate: boolean } | null = null;
  const openWaiters: Array<() => void> = [];

  const machine = createConnectionMachine({
    clock,
    emit: emitConnection,
    reconnect: () => connect(),
  });

  function connect(): void {
    if (disposed || socket) return;
    const token = tokenStore.getTokens()?.accessToken ?? null;
    if (!token) return; // wait until a token exists
    currentToken = token;
    lastSeq = null;
    machine.connecting();
    const ws = webSocket(panelWsUrl(apiBaseUrl), [token]);
    socket = ws;
    ws.onopen = () => {
      machine.opened();
      const waiters = openWaiters.splice(0, openWaiters.length);
      for (const resolve of waiters) resolve();
    };
    ws.onmessage = (event) => handleMessage(event.data);
    ws.onerror = () => {
      /* the close handler drives reconnection */
    };
    ws.onclose = () => {
      if (socket !== ws) return;
      socket = null;
      if (disposed) return;
      const next = pending ?? { reason: 'reconnect' as const, immediate: false };
      pending = null;
      machine.lost(next.reason, next.immediate);
    };
  }

  function closeAndReconnect(reason: 'reconnect' | 'seq-gap', immediate: boolean): void {
    pending = { reason, immediate };
    if (socket) socket.close();
    else machine.lost(reason, immediate);
  }

  function handleMessage(data: string): void {
    let raw: unknown;
    try {
      raw = JSON.parse(data);
    } catch {
      socket?.close(POLICY_VIOLATION, 'invalid json');
      return;
    }
    const parsed = zEventEnvelope.safeParse(raw);
    if (!parsed.success) {
      socket?.close(POLICY_VIOLATION, 'invalid frame');
      return;
    }
    const envelope = parsed.data;
    if (lastSeq !== null && envelope.seq !== lastSeq + 1) {
      // A gap: do not patch. Re-subscribe for a fresh snapshot.
      lastSeq = null;
      closeAndReconnect('seq-gap', true);
      return;
    }
    lastSeq = envelope.seq;
    events.emit(envelope);
  }

  const ensureConnected = (): void => {
    if (subscribers > 0 && !socket && !disposed) connect();
  };

  const offTokens = tokenStore.subscribeTokens((tokens) => {
    if (disposed) return;
    const token = tokens?.accessToken ?? null;
    if (!token) {
      // Credentials cleared: close and do not reconnect until a token returns.
      pending = null;
      if (socket) {
        const ws = socket;
        socket = null;
        ws.onclose = null;
        ws.close();
      }
      currentToken = null;
      machine.closed();
      return;
    }
    if (token !== currentToken && socket) {
      closeAndReconnect('reconnect', true);
    } else {
      ensureConnected();
    }
  });

  const trackedEvents: EventStream<EventEnvelope> = {
    subscribe(listener) {
      subscribers += 1;
      const off = events.subscribe(listener);
      ensureConnected();
      return wrapOff(off);
    },
  };
  const connection$: EventStream<ConnectionStatus> = {
    subscribe(listener) {
      subscribers += 1;
      connectionListeners.add(listener);
      if (lastStatus) listener(lastStatus);
      ensureConnected();
      return wrapOff(() => connectionListeners.delete(listener));
    },
  };

  function wrapOff(off: Unsubscribe): Unsubscribe {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      subscribers -= 1;
      off();
    };
  }

  return {
    events$: trackedEvents,
    connection$,
    resync() {
      return new Promise<void>((resolve) => {
        openWaiters.push(resolve);
        closeAndReconnect('seq-gap', true);
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      offTokens();
      machine.dispose();
      if (socket) {
        const ws = socket;
        socket = null;
        ws.onclose = null;
        ws.close();
      }
    },
  };
}
