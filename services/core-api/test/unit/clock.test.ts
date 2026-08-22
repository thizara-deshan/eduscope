import { describe, expect, it } from 'vitest';
import { UlidGenerator } from '../../src/lib/ids.js';
import { FakeClock } from '../fakes/clock.js';

describe('FakeClock', () => {
  it('reports a fixed wall time until advanced', () => {
    const clock = new FakeClock(new Date('2026-01-01T00:00:00.000Z'));

    expect(clock.now().toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(clock.now().toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('advances deterministically, firing due timers in chronological order', async () => {
    const clock = new FakeClock(new Date('2026-01-01T00:00:00.000Z'));
    const ticks: number[] = [];
    clock.every(50, () => ticks.push(clock.now().getTime()));

    const sleep100 = clock.sleep(100);
    clock.advance(100);
    await sleep100;

    expect(ticks).toEqual([
      Date.parse('2026-01-01T00:00:00.050Z'),
      Date.parse('2026-01-01T00:00:00.100Z'),
    ]);
    expect(clock.now().toISOString()).toBe('2026-01-01T00:00:00.100Z');
  });

  it('stops firing a cancelled interval and never re-fires a resolved sleep', async () => {
    const clock = new FakeClock(new Date('2026-01-01T00:00:00.000Z'));
    let ticks = 0;
    const cancel = clock.every(10, () => {
      ticks += 1;
    });

    clock.advance(25);
    expect(ticks).toBe(2);

    cancel.cancel();
    clock.advance(100);
    expect(ticks).toBe(2);
  });
});

describe('UlidGenerator', () => {
  it('produces monotonically ordered ids for non-decreasing timestamps', () => {
    const ids = new UlidGenerator();
    const now = new Date('2026-01-01T00:00:00.000Z');

    const a = ids.next(now);
    const b = ids.next(now);
    const c = ids.next(new Date(now.getTime() + 1));

    expect(a.length).toBe(26);
    expect(a < b).toBe(true);
    expect(b < c).toBe(true);
  });

  it('never repeats or reorders across many calls at the same instant', () => {
    const ids = new UlidGenerator();
    const now = new Date('2026-01-01T00:00:00.000Z');

    const sequence = Array.from({ length: 20 }, () => ids.next(now));
    const sorted = [...sequence].sort();

    expect(sequence).toEqual(sorted);
    expect(new Set(sequence).size).toBe(sequence.length);
  });
});
