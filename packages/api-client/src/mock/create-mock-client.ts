import type { EduscopeClient, PreviewChannel } from '../client.js';
import { createEmitter, type ConnectionStatus, type EventStream } from '../stream.js';
import type { Clock } from './clock.js';
import { createWallClock } from './clock.js';
import { ALL_MACHINES, BOUND_SOURCE_ROLES, sourceTransitionId } from './machines/index.js';
import type { MachineId, Transition } from './machines/types.js';
import { createRestOperations } from './rest/index.js';
import { createScenarioEngine, getScenario } from './scenario/registry.js';
import type { ScenarioName, WorldSeed } from './scenario/types.js';
import { createSeed, type Seed } from './seed/index.js';
import { createConnectionController } from './events/connection.js';
import { createEnvelopeStream } from './events/emitter.js';
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
  // Envelope forwarding, connection-lifetime `seq` stamping and snapshot replay
  // all live in events/emitter.ts — see its docblock for why the counter has to
  // outlive the world it is stamping.
  const envelopes = createEnvelopeStream(() => world);

  // Stable across a `switchScenario` the same way `outward` is (review I5):
  // `build()` mints a fresh `ConnectionController` every time, so nothing may
  // hand a caller that controller's own `connection$` directly — its identity
  // changes on every switch and any existing subscriber would go silent.
  // `lastConnectionStatus` lets a subscriber that attaches after construction
  // (or after a switch) still observe the current phase immediately (review
  // I6), the same way `events$` replays `world.snapshot()` on subscribe.
  const outwardConnection = createEmitter<ConnectionStatus>();
  let lastConnectionStatus: ConnectionStatus | undefined;
  const connectionStream: EventStream<ConnectionStatus> = {
    subscribe(listener) {
      if (lastConnectionStatus) listener(lastConnectionStatus);
      return outwardConnection.subscribe(listener);
    },
  };

  let current: ScenarioName = scenario;
  let teardown: (() => void)[] = [];
  let world!: MockWorld;
  let rest!: ReturnType<typeof createRestOperations>;
  let connection!: ReturnType<typeof createConnectionController>;

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
    teardown.push(envelopes.attach(world));

    // Bootstrap live machine state from the seed BEFORE anything reads it
    // (review I2/I3/I4): without this, the WS snapshot, `getStorageOverview()`,
    // `getSourcesStatus()` and command refusals each read a different "truth"
    // for the same world instead of the one shared mock world the design
    // requires.
    bootstrapFromSeed(world, seed, script.seed ?? {});

    rest = createRestOperations({ world, engine, seed });
    // `start()` returns void (post-Task-11-fix ConnectionController), unlike
    // the brief's imagined "returns a stop callback" shape — call it for its
    // side effect and push the bound `stop` method itself onto teardown.
    // Subscribe to the fresh controller's own stream BEFORE calling `start()`
    // so its synchronous connecting -> open emissions on construction aren't
    // lost, and forward them into the stable `outwardConnection` emitter
    // declared above (review I5/I6).
    connection = createConnectionController(world, script);
    teardown.push(
      connection.connection$.subscribe((status) => {
        lastConnectionStatus = status;
        outwardConnection.emit(status);
      }),
    );
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

    events$: envelopes.events$,
    connection$: connectionStream,
    openPreview: (): PreviewChannel => createPreviewChannel(world),
    resync: async () => {
      // Re-stamp with the outer monotonic counter, same as the live forwarder
      // above — replaying `world.snapshot()`'s raw (world-internal, per-scenario)
      // seq values here would violate the "seq is monotonic per connection"
      // contract stream.ts documents.
      envelopes.replay(world);
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


/**
 * Drives live machine state to agree with the seed/WorldSeed BEFORE anything
 * reads it. Without this, the WS snapshot, `getStorageOverview()`,
 * `getSourcesStatus()`, and command refusals each read a different "truth"
 * for one world (review I2/I3/I4) — the entire point of a shared mock world
 * is that every surface agrees.
 */
function bootstrapFromSeed(world: MockWorld, seed: Seed, worldSeed: Partial<WorldSeed>): void {
  // storage (5b): byte counts/policy come straight from the seed — the same
  // values rest/storage.ts's getStorageOverview() already reads — so
  // health.ts's storageMachine payload builder (which falls back to its own
  // hardcoded defaults when `world.data` is unset) agrees with it. Pressure
  // is driven through the real HL-10/HL-12 transitions, not just labeled, so
  // `world.state('storage')` and every alert/side-effect those transitions
  // carry are genuine.
  world.data['storage.freeBytes'] = seed.storage.freeBytes;
  world.data['storage.totalBytes'] = seed.storage.totalBytes;
  world.data['storage.policy'] = seed.storage.policy;
  const pressure = worldSeed.storagePressure ?? 'ok';
  if (pressure === 'warning' || pressure === 'critical') world.apply('HL-10');
  if (pressure === 'critical') world.apply('HL-12');

  // sources (5a): the four bound roles boot `online` — rest/sources.ts's
  // getSourcesStatus() always reads the live machine for these, whose
  // `initial` is `unknown`, so without this every REST/WS surface would
  // contradict the seed's `sourceStatuses` fixture (which says `online`).
  // `mic-room` has no registered machine at all (INV-SR-2) and keeps
  // whatever `sourceStatuses` seeds it as (`unbound`).
  for (const roleId of BOUND_SOURCE_ROLES) {
    world.apply(sourceTransitionId(roleId, 'HL-02'));
  }

  // Recorded for a future session-bootstrap task to consume — no current
  // scenario script sets this (only `disk-full` uses `WorldSeed` at all, and
  // only for `storagePressure`), and fabricating a whole in-progress
  // "owned by someone else" session is a bigger design decision than this
  // fix is meant to make (seed/index.ts's own comment defers it the same way).
  if (worldSeed.recordingOwnedByOtherUser) {
    world.data['session.recordingOwnedByOtherUser'] = true;
  }
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

  // sources.status: the four bound roles are machine-driven (bootstrapped
  // online above) and read live, same as rest/sources.ts's getSourcesStatus();
  // `mic-room` has no registered machine and reads the seed fallback, same
  // split that REST call already makes.
  for (const role of seed.sourceRoles) {
    if (!BOUND_SOURCE_ROLES.includes(role.id)) {
      const fallback = seed.sourceStatuses.find((s) => s.roleId === role.id)!;
      world.emit('sources.status', fallback);
      continue;
    }
    world.emit(
      'sources.status',
      PAYLOAD_BUILDERS['sources.status']!(world, snapshotTransition(`source:${role.id}`)),
    );
  }

  // system.alert genuinely is a static seed fixture with no machine behind
  // its *initial* rows, so it is emitted straight from the seed.
  for (const a of seed.alerts) world.emit('system.alert', a);

  // channel.state: `local` mirrors machine 1a directly rather than being
  // driven by its own registered machine (channel.ts's own module comment),
  // but it IS one of the 3 channels the contract documents and IS what
  // rest/channels.ts's listChannels() already returns for it — a real
  // backend would emit this on subscribe same as meeting/streaming, so it is
  // built by hand here the same way listChannels() builds it (review C1).
  const localChannel = seed.channels.find((c) => c.channelId === 'local');
  if (localChannel) {
    world.emit('channel.state', {
      channelId: 'local',
      state: 'on',
      presetId: localChannel.presetId,
      ratioA: localChannel.ratioA,
      ratioB: localChannel.ratioB,
      reason: null,
    });
  }
  // meeting/streaming ARE machine-driven (channel.ts registers channel:meeting
  // / channel:streaming) — seed.channels is a ChannelConfig (id/preset/ratios),
  // not the ChannelStatus shape channel.state carries (it has no `state`
  // field), so mirror rest/channels.ts's listChannels and read the live
  // machine for these two.
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
