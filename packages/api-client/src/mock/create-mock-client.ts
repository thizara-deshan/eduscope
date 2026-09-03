import type { EduscopeClient, PreviewChannel } from '../client.js';
import { TransportError } from '../errors.js';
import { createEmitter, type ConnectionStatus, type EventStream } from '../stream.js';
import type { Clock } from './clock.js';
import { createWallClock } from './clock.js';
import { ALL_MACHINES, BOUND_SOURCE_ROLES, sourceTransitionId } from './machines/index.js';
import type { MachineId, Transition } from './machines/types.js';
import { createRestOperations } from './rest/index.js';
import type { ScenarioEngine } from './scenario/engine.js';
import { createScenarioEngine, getScenario } from './scenario/registry.js';
import type { ScenarioName, WorldSeed } from './scenario/types.js';
import { createSeed, type Seed } from './seed/index.js';
import { createCredentialStore } from './seed/users.js';
import { createConnectionController } from './events/connection.js';
import { createEnvelopeStream } from './events/emitter.js';
import { createPreviewChannel } from './events/preview.js';
import { startAudioLevels } from './events/telemetry.js';
import { MockWorld, PAYLOAD_BUILDERS, nextUlid } from './world.js';

export { isMockPreviewFrame } from './events/preview.js';

export interface MockClient extends EduscopeClient {
  readonly scenario: ScenarioName;
  /** The merged `WorldSeed` this world is actually running (W2-D-1). */
  readonly worldSeed: WorldSeed;
  readonly world: MockWorld;
  /** Dev-overlay only: rebuild the world under a different script and/or seed, live. */
  switchScenario(name: ScenarioName, seed?: Partial<WorldSeed>): void;
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
  options: { clock?: Clock; seed?: Partial<WorldSeed> } = {},
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
  // Re-derived on every build so `worldSeed` always describes the world that
  // is actually running, not the last override a caller happened to pass.
  let effectiveSeed!: WorldSeed;
  let teardown: (() => void)[] = [];
  let world!: MockWorld;
  let rest!: ReturnType<typeof createRestOperations>;
  let connection!: ReturnType<typeof createConnectionController>;
  let engine!: ScenarioEngine;
  // Cached so `client.login === client.login`. A fresh closure per property
  // access would break every dependency array that captures one operation.
  let wrapped = new Map<string, (...args: never[]) => Promise<unknown>>();

  function build(name: ScenarioName, seedOverride: Partial<WorldSeed> = {}): void {
    const authenticatedUserId = world?.data['auth.currentUserId'];
    for (const stop of teardown) stop();
    teardown = [];

    const script = getScenario(name);
    engine = createScenarioEngine(script);
    wrapped = new Map();
    engine.reset();

    const merged: WorldSeed = {
      storagePressure: 'ok',
      aiEnabled: true,
      quizAvailable: true,
      recordingOwnedByOtherUser: false,
      audioApplyFails: false,
      studentsCameraBound: true,
      streamTargetsConfigured: true,
      recordingsPresent: true,
      exportOutcome: 'complete',
      provisioned: true,
      clockSynced: true,
      diskHealth: 'good',
      networkApplyFails: false,
      firmwareOutcome: 'update-available',
      userImportRejects: false,
      ...script.seed,
      ...seedOverride,
    };
    effectiveSeed = merged;
    const seed = createSeed(merged);
    world = new MockWorld({ clock, intercept: engine.intercept });
    for (const machine of ALL_MACHINES) world.registerMachine(machine);

    // Re-stamp seq so it stays monotonic per connection across a live switch.
    teardown.push(envelopes.attach(world));

    // Bootstrap live machine state from the seed BEFORE anything reads it
    // (review I2/I3/I4): without this, the WS snapshot, `getStorageOverview()`,
    // `getSourcesStatus()` and command refusals each read a different "truth"
    // for the same world instead of the one shared mock world the design
    // requires.
    bootstrapFromSeed(world, seed, merged);
    if (authenticatedUserId) world.data['auth.currentUserId'] = authenticatedUserId;

    // Built before `rest` (moved ahead of it for v0.3 / CG-16 — device.ts's
    // powerOffDevice needs a live `connection` reference to close the
    // transport on a successful shutdown). Subscribe to the fresh
    // controller's own stream BEFORE calling `start()` so its synchronous
    // connecting -> open emissions on construction aren't lost, and forward
    // them into the stable `outwardConnection` emitter declared above
    // (review I5/I6).
    connection = createConnectionController(world, script);
    teardown.push(
      connection.connection$.subscribe((status) => {
        lastConnectionStatus = status;
        outwardConnection.emit(status);
      }),
    );

    // Minted here, beside `createSeed()`, so it has exactly the seed's
    // lifetime: a `switchScenario` rebuilds the world, so it must also discard
    // any password a previous script's run changed.
    rest = createRestOperations({
      world, engine, seed, connection, worldSeed: merged, credentials: createCredentialStore(),
    });
    // `start()` returns void (post-Task-11-fix ConnectionController), unlike
    // the brief's imagined "returns a stop callback" shape — call it for its
    // side effect and push the bound `stop` method itself onto teardown.
    connection.start();
    teardown.push(connection.stop);
    teardown.push(startAudioLevels(world, BOUND_SOURCE_ROLES));

    // W2-D-2: transitions this script DRIVES. Scheduled last so the world is
    // fully bootstrapped (every bound role already `online`) before the first
    // fault fires, and through `world.schedule` so a `switchScenario` discards
    // them with the world they were scheduled against.
    for (const entry of script.timeline ?? []) {
      world.schedule(entry.transition, entry.afterMs);
    }

    for (const e of script.emits ?? []) {
      world.clock.setTimeout(() => world.emit(e.event, e.payload(seed)), e.afterMs);
    }

    // events.md §1: the server emits the current snapshot on subscribe.
    seedSnapshot(world, seed);
    current = name;
  }

  build(scenario, options.seed ?? {});

  const client = {
    get scenario() {
      return current;
    },
    get worldSeed(): WorldSeed {
      return effectiveSeed;
    },
    get world() {
      return world;
    },
    switchScenario(name: ScenarioName, seed?: Partial<WorldSeed>) {
      build(name, seed ?? {});
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
      if (typeof op !== 'function') return undefined;
      const cached = wrapped.get(prop);
      if (cached) return cached;
      /**
       * The transport check sits HERE, not in each panel operation: a
       * transport failure is by definition the request not arriving, so it
       * cannot be the responsibility of the code that would have handled it.
       */
      const fn = (...args: never[]): Promise<unknown> => {
        const fault = engine.onTransport(prop);
        if (!fault) return op(...args);
        return new Promise((_resolve, reject) => {
          setTimeout(() => reject(new TransportError(prop)), fault.delayMs);
        });
      };
      wrapped.set(prop, fn);
      return fn;
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

  // Wave 4 (W4-D-1): the AI studio arms and the quiz session opens on record-start
  // (R-05's data reducer reads these), gated by the same world seeds the overlay
  // already exposes. Stamped here so REST snapshots and the record-start drive agree.
  world.data['ai.enabledAtStart'] = worldSeed.aiEnabled ?? true;
  world.data['quiz.available'] = worldSeed.quizAvailable ?? true;

  // sources (5a): the four bound roles boot `online` — rest/sources.ts's
  // getSourcesStatus() always reads the live machine for these, whose
  // `initial` is `unknown`, so without this every REST/WS surface would
  // contradict the seed's `sourceStatuses` fixture (which says `online`).
  // `mic-room` has no registered machine at all (INV-SR-2) and keeps
  // whatever `sourceStatuses` seeds it as (`unbound`).
  // W3-D-4: `studentsCameraBound: false` keeps the students-cam role in its
  // real `unbound` machine state (HL-01) rather than driving it `online` —
  // every REST/WS surface that reads this role's live machine agrees.
  for (const roleId of BOUND_SOURCE_ROLES) {
    if (roleId === 'students-cam' && worldSeed.studentsCameraBound === false) {
      world.apply(sourceTransitionId(roleId, 'HL-01'));
      continue;
    }
    world.apply(sourceTransitionId(roleId, 'HL-02'));
  }

  // v0.3 / S-06 §10 — "no seeded second user is an owner" gap: seeds a
  // session already `recording`, owned by `a.perera` (the seed's canonical
  // lecturer — every past Recording in seed/recordings.ts is already theirs),
  // so LP-6's locked view (S-06 states 1/2/9) is reachable by logging in as
  // anyone else. `seedState` bypasses `apply()` because no single legal
  // transition reaches `recording` from `idle`, and going through
  // startRecording's real R-01->R-05 chain would additionally schedule a
  // second, later R-05 via R-01's own `fire` effect (issue flagged in
  // task-10-report.md, not this fix's to solve) that would then apply
  // against a state it no longer agrees with.
  if (worldSeed.recordingOwnedByOtherUser) {
    const owner = seed.users.find((u) => u.username === 'a.perera')!;
    const recordedDurationMs = 67 * 60_000 + 12_000; // wireframe reference figure: 01:07:12
    world.data['session.ulid'] = nextUlid(world);
    world.data['session.startReason'] = 'initial';
    world.data['session.title'] = 'CS2043 — Lecture 7';
    world.data['session.ownerUserId'] = owner.id;
    world.data['session.ownerDisplayName'] = owner.displayName;
    world.data['session.startedAt'] = new Date(world.clock.now() - recordedDurationMs).toISOString();
    world.data['session.recordedDurationMs'] = 0;
    world.data['session.currentSegmentStartedAtMs'] = world.clock.now() - recordedDurationMs;
    world.data['session.segmentIndex'] = 1;
    world.data['session.segmentCount'] = 1;
    world.data['session.pauseCount'] = 0;
    world.seedState('recording', 'recording');
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

  for (const control of seed.audioControls) world.emit('audio.control', control);

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
