import { describe, expect, it } from 'vitest';
import { zEventEnvelope } from '@eduscope/shared';
import { createVirtualClock } from '../../src/mock/clock.js';
import { MockWorld } from '../../src/mock/world.js';
import { recordingMachine } from '../../src/mock/machines/recording.js';

function world() {
  const clock = createVirtualClock('2026-07-30T09:00:00.000+00:00');
  const w = new MockWorld({ clock });
  w.registerMachine(recordingMachine);
  return { w, clock };
}

describe('MockWorld', () => {
  it('starts machine 1a in idle — idle is the absence of a session', () => {
    const { w } = world();
    expect(w.state('recording')).toBe('idle');
  });

  it('applies R-01 and emits recording.state{starting}', () => {
    const { w } = world();
    const seen: unknown[] = [];
    w.subscribeEvents((e) => seen.push(e));
    w.apply('R-01');
    expect(w.state('recording')).toBe('starting');
    const evt = zEventEnvelope.parse(seen.at(-1));
    expect(evt.event).toBe('recording.state');
    expect(evt.payload).toMatchObject({ state: 'starting', startReason: 'initial' });
  });

  it('refuses a transition whose `from` does not match, and says why', () => {
    const { w } = world();
    expect(() => w.apply('R-05')).toThrow(/R-05.*from idle/);
  });

  it('numbers events with a monotonic per-connection seq', () => {
    const { w } = world();
    const seen: { seq: number }[] = [];
    w.subscribeEvents((e) => seen.push(e));
    w.apply('R-01');
    w.apply('R-05');
    expect(seen.map((e) => e.seq)).toEqual([0, 1]);
  });

  it('runs scheduled transitions only when the virtual clock advances', () => {
    const { w, clock } = world();
    w.apply('R-01');
    w.schedule('R-05', 1_200);
    expect(w.state('recording')).toBe('starting');
    clock.advance(1_199);
    expect(w.state('recording')).toBe('starting');
    clock.advance(1);
    expect(w.state('recording')).toBe('recording');
  });

  it('replays a schema-valid snapshot on subscribe (events.md §1)', () => {
    const { w } = world();
    w.apply('R-01');
    const snapshot = w.snapshot();
    expect(snapshot.map((e) => e.event)).toContain('recording.state');
    for (const e of snapshot) expect(() => zEventEnvelope.parse(e)).not.toThrow();
  });
});
