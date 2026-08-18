import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DomainBus } from '../../src/lib/domain-bus.js';
import { PipelineManagerClient } from '../../src/modules/recording/pm/client.js';
import { PipelineManagerBridge } from '../../src/modules/recording/pm/dispatcher.js';
import type { Cancel } from '../../src/lib/clock.js';
import { FakeClock } from '../fakes/clock.js';
import { FakePipelineManager } from '../fakes/pipeline-manager.js';

const BEARER = 'secret-bridge-bearer-token';

/** Records every `sleep()` duration the bridge requests, so backoff can be asserted without real waiting. */
class RecordingClock extends FakeClock {
  readonly sleeps: number[] = [];

  override sleep(ms: number, signal?: AbortSignal): Promise<void> {
    this.sleeps.push(ms);
    return super.sleep(ms, signal);
  }

  override every(ms: number, run: () => void): Cancel {
    return super.every(ms, run);
  }
}

async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor: condition not met in time');
    }
    await delay(5);
  }
}

interface Harness {
  fake: FakePipelineManager;
  bus: DomainBus;
  clock: RecordingClock;
  bridge: PipelineManagerBridge;
  warnings: Array<{ message: string; meta?: Record<string, unknown> }>;
}

async function createHarness(): Promise<Harness> {
  const fake = new FakePipelineManager({ bearerToken: BEARER });
  const baseUrl = await fake.listen();
  const bus = new DomainBus();
  const clock = new RecordingClock();
  const warnings: Harness['warnings'] = [];
  const client = new PipelineManagerClient({ baseUrl, bearerToken: BEARER });
  const bridge = new PipelineManagerBridge({
    client,
    bus,
    clock,
    logger: {
      warn: (message, meta) => {
        warnings.push(meta === undefined ? { message } : { message, meta });
      },
    },
  });
  return { fake, bus, clock, bridge, warnings };
}

async function destroyHarness(harness: Harness): Promise<void> {
  await harness.bridge.stop('shutdown');
  await harness.fake.close();
}

describe('PipelineManagerBridge', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await createHarness();
  });

  afterEach(async () => {
    await destroyHarness(h);
  });

  it('opens exactly one SSE connection and forces a /status read on initial connect', async () => {
    await h.bridge.start();
    await waitFor(() => h.fake.openConnectionCount === 1);

    expect(h.fake.calls.filter((c) => c.path === '/status')).toHaveLength(1);
    expect(h.fake.calls.filter((c) => c.path === '/events')).toHaveLength(1);
    expect(h.fake.openConnectionCount).toBe(1);
  });

  it('dispatches evt.pm.consumer.running to the domain bus', async () => {
    const received: Array<{ consumerId: string; pgid: number | null }> = [];
    h.bus.subscribe('evt.pm.consumer.running', (payload) => received.push(payload));

    await h.bridge.start();
    await waitFor(() => h.fake.openConnectionCount === 1);

    h.fake.publish('evt.pm.consumer.running', { consumerId: 'record:00000001', pgid: 4242 });
    await waitFor(() => received.length === 1);

    expect(received[0]).toEqual({ consumerId: 'record:00000001', pgid: 4242 });
  });

  it('publishes pm.status.resynced with the fetched snapshot', async () => {
    const snapshots: Array<{ sequence: number }> = [];
    h.bus.subscribe('pm.status.resynced', (status) => snapshots.push(status));

    await h.bridge.start();
    await waitFor(() => snapshots.length === 1);

    expect(snapshots[0]!.sequence).toBe(0);
  });

  it('replays via Last-Event-ID after a reconnect and never redelivers an already-applied event', async () => {
    const received: string[] = [];
    h.bus.subscribe('evt.pm.consumer.running', (payload) => received.push(payload.consumerId));

    await h.bridge.start();
    await waitFor(() => h.fake.openConnectionCount === 1);

    h.fake.publish('evt.pm.consumer.running', { consumerId: 'first', pgid: 1 });
    await waitFor(() => received.length === 1);

    h.fake.dropConnections();
    await waitFor(() => h.clock.sleeps.length === 1);
    expect(h.clock.sleeps[0]).toBe(1000); // first backoff step (T-CONSUMER-RESTART)

    // Published while disconnected — the reconnect must pick this up via
    // Last-Event-ID replay (it happened after seq 1, the bridge's watermark).
    h.fake.publish('evt.pm.consumer.running', { consumerId: 'second', pgid: 2 });

    h.clock.advance(1000);
    await waitFor(() => received.length === 2);

    expect(received).toEqual(['first', 'second']);
    expect(h.fake.calls.filter((c) => c.path === '/status').length).toBeGreaterThanOrEqual(2);
    expect(h.fake.calls.filter((c) => c.path === '/events').length).toBeGreaterThanOrEqual(2);
  });

  it('suppresses a duplicate event redelivered at an already-applied sequence', async () => {
    const received: string[] = [];
    h.bus.subscribe('evt.pm.consumer.running', (payload) => received.push(payload.consumerId));

    await h.bridge.start();
    await waitFor(() => h.fake.openConnectionCount === 1);

    const seq = h.fake.publish('evt.pm.consumer.running', { consumerId: 'first', pgid: 1 });
    await waitFor(() => received.length === 1);

    // Redeliver the exact same sequence on the still-open connection
    // (an overlapping replay/live race) — must not be applied twice.
    h.fake.replayHistoryEvent(seq);
    await delay(50);

    expect(received).toEqual(['first']);
  });

  it('backs off 1s, 3s, 8s (T-CONSUMER-RESTART) between reconnect attempts while the server is unreachable', async () => {
    h.fake.setOffline(true);

    await h.bridge.start();

    await waitFor(() => h.clock.sleeps.length === 1);
    expect(h.clock.sleeps[0]).toBe(1000);
    h.clock.advance(1000);

    await waitFor(() => h.clock.sleeps.length === 2);
    expect(h.clock.sleeps[1]).toBe(3000);
    h.clock.advance(3000);

    await waitFor(() => h.clock.sleeps.length === 3);
    expect(h.clock.sleeps[2]).toBe(8000);

    h.fake.setOffline(false);
    h.clock.advance(8000);

    await waitFor(() => h.fake.openConnectionCount === 1);
  });

  it('resets backoff to the first step after a successful reconnect', async () => {
    await h.bridge.start();
    await waitFor(() => h.fake.openConnectionCount === 1);

    h.fake.dropConnections();
    await waitFor(() => h.clock.sleeps.length === 1);
    expect(h.clock.sleeps[0]).toBe(1000);
    h.clock.advance(1000);
    await waitFor(() => h.fake.openConnectionCount === 1);

    h.fake.dropConnections();
    await waitFor(() => h.clock.sleeps.length === 2);
    expect(h.clock.sleeps[1]).toBe(1000); // back to the first step, not 3000
  });

  it('never logs the bearer token when a connection attempt fails', async () => {
    h.fake.setOffline(true);
    await h.bridge.start();

    await waitFor(() => h.warnings.length >= 1);
    for (const warning of h.warnings) {
      expect(warning.message).not.toContain(BEARER);
      expect(JSON.stringify(warning.meta ?? {})).not.toContain(BEARER);
    }
  });

  it('shuts down cleanly: stop() closes the connection and issues no PM consumer stop', async () => {
    await h.bridge.start();
    await waitFor(() => h.fake.openConnectionCount === 1);

    await h.bridge.stop('shutdown');
    await waitFor(() => h.fake.openConnectionCount === 0);

    expect(h.fake.calls.some((c) => c.path.includes('/stop'))).toBe(false);
  });
});
