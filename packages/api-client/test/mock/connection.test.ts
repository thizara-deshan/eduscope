import { describe, expect, it } from 'vitest';
import { createVirtualClock } from '../../src/mock/clock.js';
import { MockWorld } from '../../src/mock/world.js';
import { sourceMachine } from '../../src/mock/machines/health.js';
import { createConnectionController } from '../../src/mock/events/connection.js';
import type { ScenarioScript } from '../../src/mock/scenario/types.js';
import type { ConnectionStatus } from '../../src/stream.js';

function world() {
  const clock = createVirtualClock('2026-07-30T09:00:00.000+00:00');
  const w = new MockWorld({ clock });
  // Two independently-keyed `sources.status` rows — proves a resync replay
  // brings back every entity, not just one per event name (world.ts's
  // `latestKey` fix).
  w.registerMachine(sourceMachine('presentation'));
  w.registerMachine(sourceMachine('lecturer-cam'));
  w.apply('HL-02'); // presentation: unknown -> online
  w.apply('HL-02@lecturer-cam'); // lecturer-cam: unknown -> online
  return { w, clock };
}

const noFlap: ScenarioScript = {
  name: 'happy',
  description: 'No wsFlap — the connection just goes connecting -> open and stays there.',
  forced: [],
};

describe('createConnectionController', () => {
  it('goes connecting -> open on start, and stays open with no wsFlap script', () => {
    const { w, clock } = world();
    const controller = createConnectionController(w, noFlap);
    const seen: ConnectionStatus[] = [];
    controller.connection$.subscribe((s) => seen.push(s));

    controller.start();
    expect(seen.map((s) => s.phase)).toEqual(['connecting', 'open']);

    clock.advance(60_000);
    expect(seen.map((s) => s.phase)).toEqual(['connecting', 'open']); // no drift, ever
  });

  it('drives a full wsFlap cycle — reconnecting -> stale -> open+resync with a full snapshot replay — repeated `repeat` times', () => {
    const { w, clock } = world();
    const script: ScenarioScript = {
      name: 'ws-flap',
      description: 'The panel loses the event socket, twice, for this test.',
      forced: [],
      wsFlap: { afterMs: 15_000, downMs: 12_000, repeat: 2 },
    };
    const controller = createConnectionController(w, script);
    const statuses: ConnectionStatus[] = [];
    controller.connection$.subscribe((s) => statuses.push(s));

    controller.start();
    expect(statuses.map((s) => s.phase)).toEqual(['connecting', 'open']);

    // ── cycle 1 ──────────────────────────────────────────────────────────
    clock.advance(15_000); // afterMs elapses -> the socket drops
    expect(statuses.at(-1)).toMatchObject({ phase: 'reconnecting', attempt: 1 });

    clock.advance(10_000 - 1); // just under T-WS-STALE, measured from the drop
    expect(statuses.some((s) => s.phase === 'stale')).toBe(false);
    clock.advance(1); // T-WS-STALE (10s) reached
    expect(statuses.at(-1)).toMatchObject({ phase: 'stale' });

    clock.advance(12_000 - 10_000); // downMs (12s total since the drop) reached
    expect(statuses.at(-1)).toMatchObject({ phase: 'open', resyncReason: 'reconnect' });

    // The restore replayed the FULL snapshot — both sources reappear, not
    // just whichever one happened to be emitted most recently.
    const rolesInSnapshot = w
      .snapshot()
      .filter((e) => e.event === 'sources.status')
      .map((e) => (e.payload as { roleId: string }).roleId)
      .sort();
    expect(rolesInSnapshot).toEqual(['lecturer-cam', 'presentation']);

    // ── cycle 2 (repeat: 2) ──────────────────────────────────────────────
    const countAfterCycle1 = statuses.length;
    clock.advance(15_000);
    expect(statuses.at(-1)).toMatchObject({ phase: 'reconnecting', attempt: 1 }); // attempt resets per cycle
    clock.advance(12_000);
    expect(statuses.at(-1)).toMatchObject({ phase: 'open', resyncReason: 'reconnect' });
    expect(statuses.length).toBeGreaterThan(countAfterCycle1);

    // ── no cycle 3 — `repeat: 2` is exhausted, stays open indefinitely ───
    const countAfterCycle2 = statuses.length;
    clock.advance(120_000);
    expect(statuses.length).toBe(countAfterCycle2);
  });

  it('stop() cancels every pending timer — a stop()/start() cycle does not leak the dead session into the new one', () => {
    const { w, clock } = world();
    const script: ScenarioScript = {
      name: 'ws-flap',
      description: 'Aggressive flap so the whole backoff ladder + stale + restore all get scheduled fast.',
      forced: [],
      wsFlap: { afterMs: 1_000, downMs: 12_000, repeat: 5 },
    };
    const controller = createConnectionController(w, script);
    const statuses: ConnectionStatus[] = [];
    controller.connection$.subscribe((s) => statuses.push(s));

    controller.start(); // t=0: connecting, open. Schedules a drop at t=1000.
    clock.advance(1_000); // t=1000: the drop fires — schedules the backoff
    // ladder (up to t=8500), a stale timer (t=11000), and a restore/resync
    // timer (t=13000) — all tagged with THIS session's generation.
    expect(statuses.at(-1)).toMatchObject({ phase: 'reconnecting' });

    controller.stop();
    controller.start(); // a fresh session, same instant — schedules its own
    // drop at t=1000+1000=2000, its own stale at t=12000, its own restore
    // at t=14000.
    expect(statuses.at(-1)).toMatchObject({ phase: 'open' });

    // Advance up to t=13500: the OLD session's stale (t=11000) and restore
    // (t=13000) fall inside this window and must NOT fire; the NEW
    // session's own stale (t=12000) legitimately does. If timer-cancellation
    // were broken, `stale` would appear twice and a stray `resyncReason:
    // 'reconnect'` open would appear once — neither may happen.
    clock.advance(12_500);
    expect(statuses.filter((s) => s.phase === 'stale')).toHaveLength(1);
    expect(statuses.filter((s) => s.resyncReason === 'reconnect')).toHaveLength(0);
  });
});
