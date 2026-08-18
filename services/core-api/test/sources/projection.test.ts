import { setTimeout as delay } from 'node:timers/promises';
import type { SourcesStatusPayload } from '@eduscope/shared';
import { describe, expect, it } from 'vitest';
import { AudioLevelThrottle } from '../../src/modules/sources/telemetry.js';
import { SourceProjection, type SourceTransition } from '../../src/modules/sources/status.js';
import { FakeClock } from '../fakes/clock.js';

const NOW = new Date('2026-06-01T08:00:00.000Z');
const ROLE = 'lecturer-cam' as const;

/** Debounce/staleness timers resolve via a real microtask/macrotask turn after `clock.advance()`; this flushes it deterministically without a real sleep. */
async function settle(): Promise<void> {
  await delay(0);
}

function harness(): { clock: FakeClock; projection: SourceProjection; transitions: SourceTransition[] } {
  const clock = new FakeClock(NOW);
  const transitions: SourceTransition[] = [];
  const projection = new SourceProjection(clock, (transition) => transitions.push(transition));
  return { clock, projection, transitions };
}

function latest(transitions: SourceTransition[], roleId: string): SourcesStatusPayload | undefined {
  return [...transitions].reverse().find((t) => t.roleId === roleId)?.payload;
}

describe('SourceProjection (machine 5a, HL-01..HL-09)', () => {
  it('HL-01: an unbound role starts and stays unbound regardless of telemetry', () => {
    const { projection, transitions } = harness();
    projection.seed(ROLE, false, null);

    projection.observePmEvent({ kind: 'telemetry', roleId: ROLE, publisherState: 'online' });

    expect(projection.snapshot().find((s) => s.roleId === ROLE)?.state).toBe('unbound');
    expect(transitions).toHaveLength(0);
  });

  it('HL-02: unknown -> online only after T-SOURCE-DEBOUNCE (3s) of healthy readings', async () => {
    const { clock, projection, transitions } = harness();
    projection.seed(ROLE, true, 'input-1');

    projection.observePmEvent({ kind: 'telemetry', roleId: ROLE, publisherState: 'online' });

    clock.advance(2999);
    await settle();
    expect(latest(transitions, ROLE)).toBeUndefined();

    clock.advance(1);
    await settle();
    expect(latest(transitions, ROLE)?.state).toBe('online');
  });

  it('HL-04: online -> degraded only after T-SOURCE-DEGRADE (2s)', async () => {
    const { clock, projection, transitions } = harness();
    projection.seed(ROLE, true, 'input-1');
    projection.observePmEvent({ kind: 'telemetry', roleId: ROLE, publisherState: 'online' });
    clock.advance(3000);
    await settle();
    expect(latest(transitions, ROLE)?.state).toBe('online');

    projection.observePmEvent({ kind: 'telemetry', roleId: ROLE, publisherState: 'degraded' });
    clock.advance(1999);
    await settle();
    expect(latest(transitions, ROLE)?.state).toBe('online');

    clock.advance(1);
    await settle();
    expect(latest(transitions, ROLE)?.state).toBe('degraded');
  });

  it('HL-06: online -> offline only after T-SOURCE-OFFLINE (10s) of readings, kept fresh under T-HEALTH-STALE so the link itself never goes stale', async () => {
    const { clock, projection, transitions } = harness();
    projection.seed(ROLE, true, 'input-1');
    projection.observePmEvent({ kind: 'telemetry', roleId: ROLE, publisherState: 'online' });
    clock.advance(3000);
    await settle();
    expect(latest(transitions, ROLE)?.state).toBe('online');

    // Repeated "still offline" pings every 2s — under T-HEALTH-STALE (6s) so
    // the link stays fresh — accumulate toward the 10s T-SOURCE-OFFLINE debounce.
    for (let i = 0; i < 4; i += 1) {
      projection.observePmEvent({ kind: 'telemetry', roleId: ROLE, publisherState: 'offline' });
      clock.advance(2000);
      await settle();
    }
    expect(latest(transitions, ROLE)?.state).toBe('online'); // 8s elapsed, still under the 10s debounce

    projection.observePmEvent({ kind: 'telemetry', roleId: ROLE, publisherState: 'offline' });
    clock.advance(2000);
    await settle();
    expect(latest(transitions, ROLE)?.state).toBe('offline'); // 10s elapsed since the first offline reading
  });

  it('HL-08: telemetry silence for T-HEALTH-STALE (6s) since the last reading decays to unknown, never the last-healthy value (INV-DH-2)', async () => {
    const { clock, projection, transitions } = harness();
    projection.seed(ROLE, true, 'input-1');
    projection.observePmEvent({ kind: 'telemetry', roleId: ROLE, publisherState: 'online' });
    clock.advance(3000);
    await settle();
    expect(latest(transitions, ROLE)?.state).toBe('online');

    // A repeated "still online" ping resets the staleness window each time.
    projection.observePmEvent({ kind: 'telemetry', roleId: ROLE, publisherState: 'online' });
    clock.advance(5999);
    await settle();
    expect(latest(transitions, ROLE)?.state).toBe('online');

    // No further readings — the link itself goes stale 6s after the last one.
    clock.advance(1);
    await settle();
    expect(latest(transitions, ROLE)?.state).toBe('unknown');
  });

  it('HL-03: unknown -> offline is immediate (nothing was ever flowing to debounce)', async () => {
    const { projection, transitions } = harness();
    projection.seed(ROLE, true, 'input-1');

    projection.observePmEvent({ kind: 'telemetry', roleId: ROLE, publisherState: 'offline' });
    await settle();

    expect(latest(transitions, ROLE)?.state).toBe('offline');
  });

  it('HL-09: a rebind re-probes to unknown, discarding any in-flight debounce toward the old reading', async () => {
    const { clock, projection, transitions } = harness();
    projection.seed(ROLE, true, 'input-1');
    projection.observePmEvent({ kind: 'telemetry', roleId: ROLE, publisherState: 'online' });
    clock.advance(1000); // mid-debounce, not yet committed to online

    projection.observePmEvent({ kind: 'binding', roleId: ROLE, bound: true, inputId: 'input-2' });
    await settle();

    expect(latest(transitions, ROLE)?.state).toBe('unknown');
    expect(latest(transitions, ROLE)?.inputId).toBe('input-2');

    // The pre-rebind debounce must not fire later and clobber this re-probe.
    clock.advance(5000);
    await settle();
    expect(latest(transitions, ROLE)?.state).toBe('unknown');
  });

  it('unbinding a role commits HL-01 immediately and clears its input association', async () => {
    const { clock, projection, transitions } = harness();
    projection.seed(ROLE, true, 'input-1');
    projection.observePmEvent({ kind: 'telemetry', roleId: ROLE, publisherState: 'online' });
    clock.advance(3000);
    await settle();
    expect(latest(transitions, ROLE)?.state).toBe('online');

    projection.observePmEvent({ kind: 'binding', roleId: ROLE, bound: false, inputId: null });
    expect(latest(transitions, ROLE)?.state).toBe('unbound');
    expect(latest(transitions, ROLE)?.inputId).toBeNull();
  });
});

describe('AudioLevelThrottle (contracts/events.md §2.6)', () => {
  it('clamps rms to [0, 1]', () => {
    const clock = new FakeClock(NOW);
    const throttle = new AudioLevelThrottle(clock);

    expect(throttle.next('mic-lecturer', 1.4)?.rms).toBe(1);
    clock.advance(200);
    expect(throttle.next('mic-lecturer', -0.2)?.rms).toBe(0);
  });

  it('coalesces to <= 10 Hz per role', () => {
    const clock = new FakeClock(NOW);
    const throttle = new AudioLevelThrottle(clock);

    expect(throttle.next('mic-lecturer', 0.5)).not.toBeNull();
    expect(throttle.next('mic-lecturer', 0.6)).toBeNull(); // inside the 100ms window
    clock.advance(99);
    expect(throttle.next('mic-lecturer', 0.6)).toBeNull();
    clock.advance(1);
    expect(throttle.next('mic-lecturer', 0.6)).not.toBeNull();
  });
});
