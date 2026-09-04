import { describe, expect, it, vi } from 'vitest';
import type { ConnectionStatus } from '../../src/stream.js';
import {
  BACKOFF_MS,
  createConnectionMachine,
  type WsClock,
} from '../../src/real/connection.js';
import {
  createPanelSocket,
  panelWsUrl,
  type PanelWebSocketFactory,
  type PanelWebSocketLike,
} from '../../src/real/panel-ws.js';
import { createMemoryTokenStore } from '../../src/real/auth.js';

function fakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { fn: () => void; at: number }>();
  const clock: WsClock = {
    setTimeout: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimeout: (id) => {
      timers.delete(id);
    },
    now: () => now,
  };
  const advance = (ms: number): void => {
    const target = now + ms;
    for (;;) {
      let earliest: [number, { fn: () => void; at: number }] | null = null;
      for (const entry of timers) {
        if (entry[1].at <= target && (!earliest || entry[1].at < earliest[1].at)) earliest = entry;
      }
      if (!earliest) break;
      timers.delete(earliest[0]);
      now = earliest[1].at;
      earliest[1].fn();
    }
    now = target;
  };
  return { clock, advance };
}

class FakeSocket implements PanelWebSocketLike {
  onopen: ((event?: unknown) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: ((event?: unknown) => void) | null = null;
  readyState = 0;
  closedWith: number | null = null;
  private done = false;
  constructor(readonly url: string, readonly protocols: string[]) {}
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  deliver(data: string): void {
    this.onmessage?.({ data });
  }
  /** A remote/network close (not initiated by PanelSocket). */
  drop(code = 1006): void {
    if (this.done) return;
    this.done = true;
    this.readyState = 3;
    this.onclose?.({ code, reason: '' });
  }
  close(code?: number, reason?: string): void {
    if (this.done) return;
    this.done = true;
    this.closedWith = code ?? 1000;
    this.readyState = 3;
    this.onclose?.({ code: code ?? 1000, reason: reason ?? '' });
  }
}

function fakeWs() {
  const sockets: FakeSocket[] = [];
  const factory: PanelWebSocketFactory = (url, protocols) => {
    const s = new FakeSocket(url, protocols);
    sockets.push(s);
    return s;
  };
  return { factory, sockets, last: () => sockets[sockets.length - 1]! };
}

const envelope = (seq: number) =>
  JSON.stringify({
    event: 'sources.status',
    payload: {
      roleId: 'presentation',
      state: 'online',
      detail: null,
      since: '2026-09-04T00:00:00.000+00:00',
      inputId: null,
    },
    at: '2026-09-04T00:00:00.000+00:00',
    seq,
  });

const seededStore = () =>
  createMemoryTokenStore({ accessToken: 'jwt-1', refreshToken: 'r-1', expiresInSec: 900 });

// ── ConnectionMachine ──────────────────────────────────────────────────────

describe('connection machine', () => {
  it('backs off 500→10000ms and then caps at 10000ms indefinitely', () => {
    const { clock, advance } = fakeClock();
    const deltas: number[] = [];
    let last = 0;
    const machine = createConnectionMachine({
      clock,
      emit: () => {},
      reconnect: () => {
        deltas.push(clock.now() - last);
        last = clock.now();
        machine.lost('reconnect'); // simulate the reconnect failing again
      },
    });
    machine.lost('reconnect');
    last = clock.now();
    advance(80_000);
    expect(deltas.slice(0, 7)).toEqual([...BACKOFF_MS, 10_000]);
  });

  it('emits stale only after 10s continuously not-open', () => {
    const { clock, advance } = fakeClock();
    const statuses: ConnectionStatus[] = [];
    const machine = createConnectionMachine({ clock, emit: (s) => statuses.push(s), reconnect: () => {} });
    machine.lost('reconnect');
    advance(9_999);
    expect(machine.phase).not.toBe('stale');
    advance(1);
    expect(machine.phase).toBe('stale');
  });

  it('resets the attempt counter on open', () => {
    const { clock, advance } = fakeClock();
    const deltas: number[] = [];
    let last = 0;
    let failuresLeft = 0;
    const machine = createConnectionMachine({
      clock,
      emit: () => {},
      reconnect: () => {
        deltas.push(clock.now() - last);
        last = clock.now();
        if (failuresLeft-- > 0) machine.lost('reconnect');
      },
    });
    machine.lost('reconnect'); // +500
    last = clock.now();
    failuresLeft = 1;
    advance(2_000); // fires +500, then +1000
    machine.opened(); // attempt back to 0
    last = clock.now();
    machine.lost('reconnect');
    advance(600);
    expect(deltas).toEqual([500, 1000, 500]);
  });
});

// ── PanelSocket ─────────────────────────────────────────────────────────────

describe('panel socket', () => {
  it('derives the ws URL and never leaks the token into it', () => {
    expect(panelWsUrl('http://host/api/v1')).toBe('ws://host/api/v1/ws');
    expect(panelWsUrl('https://host/api/v1/')).toBe('wss://host/api/v1/ws');
  });

  it('authenticates with the access token as the sole subprotocol', () => {
    const { clock } = fakeClock();
    const { factory, sockets } = fakeWs();
    const socket = createPanelSocket({ apiBaseUrl: 'http://host/api/v1', tokenStore: seededStore(), webSocket: factory, clock });
    socket.events$.subscribe(() => {});
    expect(sockets).toHaveLength(1);
    expect(sockets[0]!.protocols).toEqual(['jwt-1']);
    expect(sockets[0]!.url).toBe('ws://host/api/v1/ws');
    expect(sockets[0]!.url).not.toContain('jwt-1');
    socket.dispose();
  });

  it('connects lazily — only after a subscriber attaches and a token exists', () => {
    const { clock } = fakeClock();
    const { factory, sockets } = fakeWs();
    const store = createMemoryTokenStore(); // no token yet
    const socket = createPanelSocket({ apiBaseUrl: 'http://host/api/v1', tokenStore: store, webSocket: factory, clock });
    expect(sockets).toHaveLength(0); // no subscriber
    socket.connection$.subscribe(() => {});
    expect(sockets).toHaveLength(0); // subscriber but no token
    store.setTokens({ accessToken: 'jwt-9', refreshToken: 'r', expiresInSec: 900 });
    expect(sockets).toHaveLength(1); // token arrived → connect
    socket.dispose();
  });

  it('publishes only contiguous, schema-valid frames', () => {
    const { clock } = fakeClock();
    const { factory, sockets } = fakeWs();
    const socket = createPanelSocket({ apiBaseUrl: 'http://host/api/v1', tokenStore: seededStore(), webSocket: factory, clock });
    const seen: number[] = [];
    socket.events$.subscribe((e) => seen.push(e.seq));
    sockets[0]!.open();
    sockets[0]!.deliver(envelope(5)); // first frame — any seq
    sockets[0]!.deliver(envelope(6)); // contiguous
    expect(seen).toEqual([5, 6]);
    socket.dispose();
  });

  it('closes 1008 on an unparseable or schema-invalid frame', () => {
    const { clock } = fakeClock();
    const { factory, sockets } = fakeWs();
    const socket = createPanelSocket({ apiBaseUrl: 'http://host/api/v1', tokenStore: seededStore(), webSocket: factory, clock });
    socket.events$.subscribe(() => {});
    sockets[0]!.open();
    sockets[0]!.deliver('}{ not json');
    expect(sockets[0]!.closedWith).toBe(1008);
    socket.dispose();
  });

  it('closes 1008 on a frame that fails zEventEnvelope', () => {
    const { clock } = fakeClock();
    const { factory, sockets } = fakeWs();
    const socket = createPanelSocket({ apiBaseUrl: 'http://host/api/v1', tokenStore: seededStore(), webSocket: factory, clock });
    socket.events$.subscribe(() => {});
    sockets[0]!.open();
    sockets[0]!.deliver(JSON.stringify({ event: 'not-a-real-event', seq: 0, at: 'x' }));
    expect(sockets[0]!.closedWith).toBe(1008);
    socket.dispose();
  });

  it('resyncs on a seq gap: emits seq-gap, drops the gapped frame, reconnects', () => {
    const { clock, advance } = fakeClock();
    const { factory, sockets } = fakeWs();
    const socket = createPanelSocket({ apiBaseUrl: 'http://host/api/v1', tokenStore: seededStore(), webSocket: factory, clock });
    const seen: number[] = [];
    const reasons: (string | undefined)[] = [];
    socket.events$.subscribe((e) => seen.push(e.seq));
    socket.connection$.subscribe((s) => reasons.push(s.resyncReason));
    sockets[0]!.open();
    sockets[0]!.deliver(envelope(5));
    sockets[0]!.deliver(envelope(8)); // gap: 6,7 missed
    expect(seen).toEqual([5]); // gapped frame not published
    expect(reasons).toContain('seq-gap');
    advance(0); // the immediate reconnect fires
    expect(sockets).toHaveLength(2);
    socket.dispose();
  });

  it('reconnects with the rotated token when it changes', () => {
    const { clock, advance } = fakeClock();
    const { factory, sockets } = fakeWs();
    const store = seededStore();
    const socket = createPanelSocket({ apiBaseUrl: 'http://host/api/v1', tokenStore: store, webSocket: factory, clock });
    socket.events$.subscribe(() => {});
    sockets[0]!.open();
    store.setTokens({ accessToken: 'jwt-2', refreshToken: 'r-2', expiresInSec: 900 });
    advance(0);
    expect(sockets).toHaveLength(2);
    expect(sockets[1]!.protocols).toEqual(['jwt-2']);
    socket.dispose();
  });

  it('backs off after a network drop, indefinitely', () => {
    const { clock, advance } = fakeClock();
    const { factory, sockets } = fakeWs();
    const socket = createPanelSocket({ apiBaseUrl: 'http://host/api/v1', tokenStore: seededStore(), webSocket: factory, clock });
    socket.events$.subscribe(() => {});
    sockets[0]!.open();
    sockets[0]!.drop(); // unexpected close
    advance(499);
    expect(sockets).toHaveLength(1); // not yet
    advance(1);
    expect(sockets).toHaveLength(2); // reconnected at 500ms
    socket.dispose();
  });

  it('cancels pending timers on dispose so no zombie reconnect fires', () => {
    const { clock, advance } = fakeClock();
    const { factory, sockets } = fakeWs();
    const socket = createPanelSocket({ apiBaseUrl: 'http://host/api/v1', tokenStore: seededStore(), webSocket: factory, clock });
    socket.events$.subscribe(() => {});
    sockets[0]!.open();
    sockets[0]!.drop();
    socket.dispose();
    advance(60_000);
    expect(sockets).toHaveLength(1); // reconnect never fired
  });

  it('resync() closes the socket, resolves on the next open, and calls no endpoint', async () => {
    const { clock, advance } = fakeClock();
    const { factory, sockets } = fakeWs();
    const socket = createPanelSocket({ apiBaseUrl: 'http://host/api/v1', tokenStore: seededStore(), webSocket: factory, clock });
    socket.events$.subscribe(() => {});
    sockets[0]!.open();
    const resolved = vi.fn();
    const done = socket.resync().then(resolved);
    advance(0); // immediate reconnect
    expect(sockets).toHaveLength(2);
    expect(resolved).not.toHaveBeenCalled();
    sockets[1]!.open();
    await done;
    expect(resolved).toHaveBeenCalledTimes(1);
    socket.dispose();
  });
});
