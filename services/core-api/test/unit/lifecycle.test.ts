import { describe, expect, it } from 'vitest';
import { LifecycleRegistry, type LifecycleComponent } from '../../src/lifecycle.js';

function makeComponent(
  name: string,
  events: string[],
  options: { failOnStart?: boolean; stopDelayMs?: number } = {},
): LifecycleComponent {
  return {
    name,
    async start() {
      if (options.failOnStart) {
        events.push(`${name}:start-fail`);
        throw new Error(`${name} failed to start`);
      }
      events.push(`${name}:start`);
    },
    async stop(reason) {
      if (options.stopDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.stopDelayMs));
      }
      events.push(`${name}:stop:${reason}`);
    },
  };
}

describe('LifecycleRegistry', () => {
  it('starts components in registration order', async () => {
    const events: string[] = [];
    const registry = new LifecycleRegistry();
    registry.register(makeComponent('a', events));
    registry.register(makeComponent('b', events));
    registry.register(makeComponent('c', events));

    await registry.start();

    expect(events).toEqual(['a:start', 'b:start', 'c:start']);
  });

  it('stops components once in reverse registration order', async () => {
    const events: string[] = [];
    const registry = new LifecycleRegistry();
    registry.register(makeComponent('a', events));
    registry.register(makeComponent('b', events));
    registry.register(makeComponent('c', events));

    await registry.start();
    events.length = 0;
    await registry.stop();

    expect(events).toEqual(['c:stop:shutdown', 'b:stop:shutdown', 'a:stop:shutdown']);
  });

  it('stops only the components that started when start fails partway, in reverse order', async () => {
    const events: string[] = [];
    const registry = new LifecycleRegistry();
    registry.register(makeComponent('a', events));
    registry.register(makeComponent('b', events));
    registry.register(makeComponent('c-fails', events, { failOnStart: true }));
    registry.register(makeComponent('d', events));

    await expect(registry.start()).rejects.toThrow('c-fails failed to start');

    expect(events).toEqual([
      'a:start',
      'b:start',
      'c-fails:start-fail',
      'b:stop:startup-failed',
      'a:stop:startup-failed',
    ]);
  });

  it('a second shutdown call awaits the same in-flight promise instead of stopping twice', async () => {
    const events: string[] = [];
    let stopInvocations = 0;
    const registry = new LifecycleRegistry();
    registry.register(
      makeComponent('slow', events, { stopDelayMs: 10 }),
    );
    registry.register({
      name: 'counter',
      async start() {},
      async stop(reason) {
        stopInvocations += 1;
        events.push(`counter:stop:${reason}`);
      },
    });

    await registry.start();
    events.length = 0;
    const first = registry.stop();
    const second = registry.stop();

    expect(second).toBe(first);
    await Promise.all([first, second]);

    expect(stopInvocations).toBe(1);
    expect(events).toEqual(['counter:stop:shutdown', 'slow:stop:shutdown']);
  });

  it('registers DB close first so it runs last on shutdown', async () => {
    const events: string[] = [];
    const registry = new LifecycleRegistry();
    registry.register(makeComponent('db', events));
    registry.register(makeComponent('pm-bridge', events));
    registry.register(makeComponent('ws-hub', events));

    await registry.start();
    events.length = 0;
    await registry.stop();

    expect(events).toEqual(['ws-hub:stop:shutdown', 'pm-bridge:stop:shutdown', 'db:stop:shutdown']);
  });
});
