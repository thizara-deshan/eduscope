import type { EventEnvelope } from '@eduscope/shared';
import type { EduscopeClient, PreviewChannel } from '../client.js';
import { createEmitter, type ConnectionStatus, type EventStream } from '../stream.js';
import type { Clock } from './clock.js';
import { createWallClock } from './clock.js';
import { ALL_MACHINES, BOUND_SOURCE_ROLES } from './machines/index.js';
import type { MachineId, Transition } from './machines/types.js';
import { createRestOperations } from './rest/index.js';
import { createScenarioEngine, getScenario } from './scenario/registry.js';
import type { ScenarioName } from './scenario/types.js';
import { createSeed, type Seed } from './seed/index.js';
import { createConnectionController } from './events/connection.js';
import { createPreviewChannel } from './events/preview.js';
import { startAudioLevels } from './events/telemetry.js';
import { MockWorld, PAYLOAD_BUILDERS } from './world.js';

export interface MockClient extends EduscopeClient {
  readonly scenario: ScenarioName;
  readonly world: MockWorld;
  /** Dev-overlay only: rebuild the world under a different script, live. */
  switchScenario(name: ScenarioName): void;
}

/**
 * The Phase-2 implementation of EduscopeClient: a discrete-event simulation of
 * docs/design/state-machines.md, seeded from contract-valid fixtures and driven
 * by the scenario catalog.
 *
 * `scenario`, `world` and `switchScenario` are NOT on EduscopeClient — only the
 * dev overlay, which holds the concrete MockClient, can reach them. A screen
 * that needs a state must add a forced transition via `extendScenario`.
 */
export function createMockClient(
  scenario: ScenarioName = 'happy',
  options: { clock?: Clock } = {},
): MockClient {
  const clock = options.clock ?? createWallClock();
  const outward = createEmitter<EventEnvelope>();

  let current: ScenarioName = scenario;
  let teardown: (() => void)[] = [];
  let world!: MockWorld;
  let rest!: ReturnType<typeof createRestOperations>;
  let connection!: ReturnType<typeof createConnectionController>;
  let seq = 0;

  function build(name: ScenarioName): void {
    for (const stop of teardown) stop();
    teardown = [];

    const script = getScenario(name);
    const engine = createScenarioEngine(script);
    engine.reset();

    const seed = createSeed(script.seed);
    world = new MockWorld({ clock, intercept: engine.intercept });
    for (const machine of ALL_MACHINES) world.registerMachine(machine);

    // Re-stamp seq so it stays monotonic per connection across a live switch.
    teardown.push(
      world.subscribeEvents((e) => {
        outward.emit({ ...e, seq: seq++ });
      }),
    );

    rest = createRestOperations({ world, engine, seed });
    // `start()` returns void (post-Task-11-fix ConnectionController), unlike
    // the brief's imagined "returns a stop callback" shape — call it for its
    // side effect and push the bound `stop` method itself onto teardown.
    connection = createConnectionController(world, script);
    connection.start();
    teardown.push(connection.stop);
    teardown.push(startAudioLevels(world, BOUND_SOURCE_ROLES));

    // events.md §1: the server emits the current snapshot on subscribe.
    seedSnapshot(world, seed);
    current = name;
  }

  build(scenario);

  const client = {
    get scenario() {
      return current;
    },
    get world() {
      return world;
    },
    switchScenario(name: ScenarioName) {
      build(name);
    },

    events$: {
      subscribe(listener: (e: EventEnvelope) => void) {
        for (const e of world.snapshot()) listener(e);
        return outward.subscribe(listener);
      },
    },
    get connection$(): EventStream<ConnectionStatus> {
      return connection.connection$;
    },
    openPreview: (): PreviewChannel => createPreviewChannel(world),
    resync: async () => {
      // Re-stamp with the outer monotonic counter, same as the live forwarder
      // above — replaying `world.snapshot()`'s raw (world-internal, per-scenario)
      // seq values here would violate the "seq is monotonic per connection"
      // contract stream.ts documents.
      for (const e of world.snapshot()) outward.emit({ ...e, seq: seq++ });
    },
    dispose() {
      for (const stop of teardown) stop();
      teardown = [];
    },
  } as unknown as MockClient;

  return new Proxy(client, {
    get(target, prop: string, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver);
      const op = rest[prop as keyof typeof rest];
      return typeof op === 'function' ? op : undefined;
    },
    has: (target, prop) => prop in target || prop in rest,
    ownKeys: (target) => [...Reflect.ownKeys(target), ...Object.keys(rest)],
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
  });
}

/** A synthetic "current state" transition — same idiom as every REST snapshot read (e.g. rest/recording.ts's getRecordingState, rest/quiz.ts's getQuizSession). */
function snapshotTransition(machine: MachineId): Transition {
  return { id: 'snapshot', machine, from: [], to: null, effects: [], cite: 'C-9' };
}

/** Emit one of every snapshot event so a cold client renders without polling. */
function seedSnapshot(world: MockWorld, seed: Seed): void {
  // recording.state / storage.status / ai.countdown / quiz.session are
  // machine-driven — their canonical current value comes from the same
  // PAYLOAD_BUILDERS the REST snapshot reads use (rest/recording.ts's
  // getRecordingState, rest/ai.ts's getAiCountdown, rest/quiz.ts's
  // getQuizSession), not from a (nonexistent) seed field.
  world.emit(
    'recording.state',
    PAYLOAD_BUILDERS['recording.state']!(world, snapshotTransition('recording')),
  );

  // sources.status and system.alert genuinely are static seed fixtures with
  // no machine behind their *initial* row (unlike the four above), so they
  // are emitted straight from the seed.
  for (const s of seed.sourceStatuses) world.emit('sources.status', s);
  for (const a of seed.alerts) world.emit('system.alert', a);

  // channel.state IS machine-driven for meeting/streaming (channel.ts
  // registers channel:meeting / channel:streaming) — seed.channels is a
  // ChannelConfig (id/preset/ratios), not the ChannelStatus shape the
  // channel.state event carries (it has no `state` field), so mirror
  // rest/channels.ts's listChannels and read the live machine for those two.
  // `local` has no registered machine (machine 1a owns it) and rest/channels.ts
  // never treats it as a WS-driven row either, so it is intentionally skipped here.
  world.emit(
    'channel.state',
    PAYLOAD_BUILDERS['channel.state']!(world, snapshotTransition('channel:meeting')),
  );
  world.emit(
    'channel.state',
    PAYLOAD_BUILDERS['channel.state']!(world, snapshotTransition('channel:streaming')),
  );

  world.emit(
    'storage.status',
    PAYLOAD_BUILDERS['storage.status']!(world, snapshotTransition('storage')),
  );

  // device.health's event payload is a strict subset of DeviceHealth and
  // seed.deviceHealth already satisfies it field-for-field (verified against
  // zDeviceHealthPayload) — same shape rest/provisioning.ts's getDeviceHealth
  // uses, so mirror it: seed values plus the live capture-card state.
  world.emit('device.health', { ...seed.deviceHealth, captureCardState: world.state('capture-card') });

  world.emit(
    'ai.countdown',
    PAYLOAD_BUILDERS['ai.countdown']!(world, snapshotTransition('ai.countdown')),
  );
  world.emit(
    'quiz.session',
    PAYLOAD_BUILDERS['quiz.session']!(world, snapshotTransition('quiz.session')),
  );
}
