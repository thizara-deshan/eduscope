import { CONSUMER_RESTART_BACKOFF_MS, TIMERS, type ChannelId, type ChannelStatePayload, type LayoutPresetId } from '@eduscope/shared';
import { eq, inArray } from 'drizzle-orm';
import type { DrizzleDb } from '../../db/client.js';
import { channelConfigs, layoutPresets, lectureSessions, physicalInputs, sourceBindings } from '../../db/schema.js';
import { ProblemError } from '../../contracts/problem.js';
import type { Clock } from '../../lib/clock.js';
import type { DomainBus, Unsubscribe } from '../../lib/domain-bus.js';
import type { IdGenerator } from '../../lib/ids.js';
import { SerialExecutor } from '../../lib/serial-executor.js';
import type { LifecycleComponent, LifecycleStopReason } from '../../lifecycle.js';
import { assertAuthOwner } from '../recording/guards.js';
import type { AuthContext } from '../auth/service.js';
import type { PipelineManagerClient } from '../recording/pm/client.js';
import { PipelineManagerError } from '../recording/pm/types.js';

/** `local` is machine 1a's (B-05) — this executor owns only the two toggleable consumers (state-machines.md §2.2). */
export type ToggleableChannelId = 'meeting' | 'streaming';
const TOGGLEABLE_CHANNEL_IDS: readonly ToggleableChannelId[] = ['meeting', 'streaming'];
const NON_TERMINAL_STATES = ['starting', 'recording', 'paused', 'stopping', 'finalizing'] as const;
const RESTART_WINDOW_MS = 120_000;

type ChannelRuntimeState = 'off' | 'preflight' | 'starting' | 'on' | 'stopping' | 'failed';

interface ChannelActivation {
  channelId: ChannelId;
  presetId: string;
  ratioA: number | null;
  ratioB: number | null;
  enabledAt: string;
  disabledAt: string | null;
}

/** LP-7 audit trail — `state_machines.md` §2.2 CH-05/CH-08 side effects, persisted on the active `LectureSession` row. */
function readActivations(session: { channelActivations: unknown }): ChannelActivation[] {
  return (session.channelActivations as ChannelActivation[] | null) ?? [];
}

function appendActivation(db: DrizzleDb, clock: Clock, sessionId: string, entry: Omit<ChannelActivation, 'enabledAt' | 'disabledAt'>): void {
  const session = db.select({ channelActivations: lectureSessions.channelActivations }).from(lectureSessions).where(eq(lectureSessions.id, sessionId)).get();
  if (!session) return;
  const activations = [...readActivations(session), { ...entry, enabledAt: clock.now().toISOString(), disabledAt: null }];
  db.update(lectureSessions).set({ channelActivations: activations }).where(eq(lectureSessions.id, sessionId)).run();
}

function closeActivation(db: DrizzleDb, clock: Clock, sessionId: string, channelId: ChannelId): void {
  const session = db.select({ channelActivations: lectureSessions.channelActivations }).from(lectureSessions).where(eq(lectureSessions.id, sessionId)).get();
  if (!session) return;
  const nowIso = clock.now().toISOString();
  const activations = readActivations(session).map((activation) =>
    activation.channelId === channelId && activation.disabledAt === null ? { ...activation, disabledAt: nowIso } : activation,
  );
  db.update(lectureSessions).set({ channelActivations: activations }).where(eq(lectureSessions.id, sessionId)).run();
}

interface ResolvedChannel {
  channelConfig: typeof channelConfigs.$inferSelect;
  layoutPreset: typeof layoutPresets.$inferSelect;
}

/** G-CHANNEL-VALID (INV-LP-1, INV-SB-3) for `meeting`/`streaming` — the local-channel variant lives in `modules/recording/guards.ts` and is not reused here to keep the two machines independent (INV-CC-2). */
function resolveToggleableChannel(db: DrizzleDb, channelId: ToggleableChannelId): ResolvedChannel {
  const channelConfig = db.select().from(channelConfigs).where(eq(channelConfigs.channelId, channelId)).get();
  if (!channelConfig) {
    throw new ProblemError(422, 'config.invalid', `The ${channelId} channel is not configured`);
  }

  const layoutPreset = db.select().from(layoutPresets).where(eq(layoutPresets.id, channelConfig.presetId as LayoutPresetId)).get();
  if (!layoutPreset) {
    throw new ProblemError(422, 'config.invalid', 'The configured preset does not exist', { meta: { presetId: channelConfig.presetId } });
  }
  if (!layoutPreset.allowedChannels.includes(channelId)) {
    throw new ProblemError(422, 'config.invalid', 'The configured preset is not allowed on this channel', { meta: { presetId: layoutPreset.id } });
  }

  const bindings = db.select().from(sourceBindings).all();
  const inputs = db.select().from(physicalInputs).all();
  const bindingByRole = new Map(bindings.map((binding) => [binding.roleId, binding]));
  const inputById = new Map(inputs.map((input) => [input.id, input]));
  for (const roleId of layoutPreset.requiredRoles) {
    const binding = bindingByRole.get(roleId);
    const bound = binding?.enabled === true && binding.physicalInputId !== null && inputById.has(binding.physicalInputId);
    if (!bound) {
      throw new ProblemError(422, 'config.invalid', 'A required source role is unbound', { meta: { roleId } });
    }
  }

  return { channelConfig, layoutPreset };
}

/** The relay push-target boundary (CH-02's "make push targets active before the pipeline connects" — INV-ST-2). B-25 supplies the real renderer/`relay.reload` client; until then this executor is still fully testable with the no-op default. */
export interface RelayTargetActivator {
  activate(streamTargetIds: readonly string[]): Promise<void>;
  deactivate(): Promise<void>;
}

export const NOOP_RELAY_ACTIVATOR: RelayTargetActivator = {
  async activate(): Promise<void> {},
  async deactivate(): Promise<void> {},
};

interface RuntimeRecord {
  channelId: ToggleableChannelId;
  state: ChannelRuntimeState;
  presetId: string;
  ratioA: number | null;
  ratioB: number | null;
  reason: string | null;
  consumerId: string | null;
  sessionId: string | null;
  disableRequested: boolean;
  restartAttempts: number;
  restartWindowStartMs: number | null;
}

export interface ChannelAccepted {
  commandId: string;
  acceptedAt: string;
  resolveBySec: number;
}

export interface ChannelExecutorLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

export interface ChannelExecutorDeps {
  db: DrizzleDb;
  clock: Clock;
  ids: IdGenerator;
  bus: DomainBus;
  pm: PipelineManagerClient;
  relay?: RelayTargetActivator;
  logger?: ChannelExecutorLogger;
}

/**
 * Machine 1c (state-machines.md §2.2, design/core-api.md §4.1): the only
 * writer of `meeting`/`streaming` runtime state. Enabling/disabling one
 * channel touches only its own PM consumer — publishers and the record
 * consumer are untouched (INV-CC-2, the death of B-06's global `killall`).
 * Runtime state is process-local; `channelActivations` on the active
 * `LectureSession` is the durable audit trail (LP-7).
 */
export class ChannelExecutor implements LifecycleComponent {
  readonly name = 'channel-executor';

  readonly #deps: ChannelExecutorDeps;
  readonly #serial = new SerialExecutor();
  readonly #records = new Map<ToggleableChannelId, RuntimeRecord>();
  #unsubscribeExited: Unsubscribe | null = null;

  constructor(deps: ChannelExecutorDeps) {
    this.#deps = deps;
    for (const channelId of TOGGLEABLE_CHANNEL_IDS) {
      this.#records.set(channelId, {
        channelId,
        state: 'off',
        presetId: '',
        ratioA: null,
        ratioB: null,
        reason: null,
        consumerId: null,
        sessionId: null,
        disableRequested: false,
        restartAttempts: 0,
        restartWindowStartMs: null,
      });
    }
  }

  async start(): Promise<void> {
    for (const channelId of TOGGLEABLE_CHANNEL_IDS) {
      const config = this.#deps.db.select().from(channelConfigs).where(eq(channelConfigs.channelId, channelId)).get();
      if (!config) continue;
      const record = this.#records.get(channelId)!;
      record.presetId = config.presetId;
      record.ratioA = config.ratioA;
      record.ratioB = config.ratioB;
    }

    this.#unsubscribeExited = this.#deps.bus.subscribe('evt.pm.consumer.exited', (payload) => {
      void this.#serial.run(() => this.#onConsumerExitedUnexpectedly(payload.consumerId)).catch((error: unknown) => {
        this.#deps.logger?.warn('channel executor: exited handler failed', { error: describeError(error) });
      });
    });
  }

  async stop(_reason: LifecycleStopReason): Promise<void> {
    this.#unsubscribeExited?.();
    this.#unsubscribeExited = null;
  }

  listStatuses(): ChannelStatePayload[] {
    return TOGGLEABLE_CHANNEL_IDS.map((channelId) => this.#toPayload(channelId));
  }

  async enable(channelId: string, actor: AuthContext): Promise<ChannelAccepted> {
    return this.#serial.run(() => this.#doEnable(channelId, actor));
  }

  async disable(channelId: string, actor: AuthContext): Promise<ChannelAccepted> {
    return this.#serial.run(() => this.#doDisable(channelId, actor));
  }

  #doEnable(channelId: string, actor: AuthContext): ChannelAccepted {
    const id = assertToggleable(channelId);
    const session = this.#loadActiveSessionOrThrow();
    assertAuthOwner(session, actor);

    const record = this.#records.get(id)!;
    if (record.state === 'on' || record.state === 'preflight' || record.state === 'starting') {
      return this.#accepted(); // idempotent: already enabled or on its way up
    }
    if (record.state !== 'off') {
      throw new ProblemError(409, 'conflict', `Cannot enable ${id} while ${record.state} — disable to acknowledge first`);
    }

    const channel = resolveToggleableChannel(this.#deps.db, id);
    record.disableRequested = false;
    record.restartAttempts = 0;
    record.restartWindowStartMs = null;
    record.presetId = channel.layoutPreset.id;
    record.ratioA = channel.channelConfig.ratioA;
    record.ratioB = channel.channelConfig.ratioB;
    record.sessionId = session.id;

    const accepted = this.#accepted();
    if (id === 'streaming') {
      this.#transition(record, 'preflight', null);
      void this.#runStreamingPreflight(record, channel).catch((error: unknown) => {
        this.#deps.logger?.warn('channel enable: streaming preflight failed unexpectedly', { error: describeError(error) });
      });
    } else {
      this.#transition(record, 'starting', null);
      void this.#launchConsumer(record, channel).catch((error: unknown) => {
        this.#deps.logger?.warn('channel enable: meeting launch failed unexpectedly', { error: describeError(error) });
      });
    }
    return accepted;
  }

  #doDisable(channelId: string, actor: AuthContext): ChannelAccepted {
    const id = assertToggleable(channelId);
    const session = this.#loadActiveSessionOrThrow();
    assertAuthOwner(session, actor);

    const record = this.#records.get(id)!;
    if (record.state === 'off') {
      return this.#accepted(); // idempotent: already off
    }
    if (record.state === 'failed') {
      // CH-10: acknowledged.
      this.#transition(record, 'off', null);
      record.consumerId = null;
      record.sessionId = null;
      return this.#accepted();
    }
    if (record.state === 'preflight') {
      // Never reached PM — nothing to stop.
      this.#transition(record, 'off', null);
      record.sessionId = null;
      return this.#accepted();
    }

    record.disableRequested = true;
    const accepted = this.#accepted();
    const consumerId = record.consumerId;
    this.#transition(record, 'stopping', null);

    void this.#finishDisable(id, consumerId).catch((error: unknown) => {
      this.#deps.logger?.warn('channel disable: stop failed unexpectedly', { error: describeError(error) });
    });
    return accepted;
  }

  /** CH-01/CH-03: elements present, relay/TLS bridge up, push target configured (A-10) — the relay itself is B-25's design; this task owns only the local guard plus the "activate before connect" ordering (INV-ST-2). */
  async #runStreamingPreflight(record: RuntimeRecord, channel: ResolvedChannel): Promise<void> {
    const streamTargetIds = channel.channelConfig.streamTargetIds ?? [];
    if (streamTargetIds.length === 0) {
      await this.#serial.run(() => this.#failChannel(record, 'streaming.no-targets-configured'));
      return;
    }

    try {
      await (this.#deps.relay ?? NOOP_RELAY_ACTIVATOR).activate(streamTargetIds);
    } catch (error) {
      await this.#serial.run(() => this.#failChannel(record, `streaming.relay-activation-failed: ${describeError(error)}`));
      return;
    }

    const stillWanted = await this.#serial.run(() => {
      if (record.disableRequested || record.state !== 'preflight') return false;
      this.#transition(record, 'starting', null);
      return true;
    });
    if (!stillWanted) return;

    await this.#launchConsumer(record, channel);
  }

  async #launchConsumer(record: RuntimeRecord, channel: ResolvedChannel): Promise<void> {
    let accepted;
    try {
      accepted =
        record.channelId === 'streaming'
          ? await this.#deps.pm.startLiveConsumer({
              preset: channel.layoutPreset.id,
              streamKey: record.channelId,
              ...(channel.channelConfig.ratioA !== null ? { ratioA: channel.channelConfig.ratioA } : {}),
              ...(channel.channelConfig.ratioB !== null ? { ratioB: channel.channelConfig.ratioB } : {}),
            })
          : await this.#deps.pm.startMeetingConsumer({
              preset: channel.layoutPreset.id,
              ...(channel.channelConfig.ratioA !== null ? { ratioA: channel.channelConfig.ratioA } : {}),
              ...(channel.channelConfig.ratioB !== null ? { ratioB: channel.channelConfig.ratioB } : {}),
            });
    } catch (error) {
      await this.#serial.run(() => this.#failChannel(record, mapPmError(error)));
      return;
    }

    const consumerId = accepted.consumerId;
    await this.#serial.run(() => {
      record.consumerId = consumerId;
    });
    this.#armConfirmRace(record, consumerId);
  }

  /** CH-05/CH-06: races `evt.pm.consumer.running`/`evt.pm.consumer.failed` (filtered by `consumerId`) against `T-CHANNEL-START`. */
  #armConfirmRace(record: RuntimeRecord, consumerId: string): void {
    const controller = new AbortController();
    let settled = false;

    const finish = (work: () => void): void => {
      if (settled) return;
      settled = true;
      unsubscribeRunning();
      unsubscribeFailed();
      controller.abort();
      void this.#serial.run(work).catch((error: unknown) => {
        this.#deps.logger?.warn('channel confirm: handling failed', { error: describeError(error) });
      });
    };

    const unsubscribeRunning = this.#deps.bus.subscribe('evt.pm.consumer.running', (payload) => {
      if (payload.consumerId !== consumerId) return;
      finish(() => this.#confirmOn(record));
    });
    const unsubscribeFailed = this.#deps.bus.subscribe('evt.pm.consumer.failed', (payload) => {
      if (payload.consumerId !== consumerId) return;
      finish(() => this.#failChannel(record, payload.code));
    });

    this.#deps.clock.sleep(TIMERS['T-CHANNEL-START'], controller.signal).then(() => {
      if (controller.signal.aborted) return; // already resolved by an event, not a genuine timeout
      finish(() => this.#failChannel(record, 'channel.confirm-timeout'));
    });
  }

  #confirmOn(record: RuntimeRecord): void {
    this.#transition(record, 'on', null);
    if (record.sessionId) {
      appendActivation(this.#deps.db, this.#deps.clock, record.sessionId, {
        channelId: record.channelId,
        presetId: record.presetId,
        ratioA: record.ratioA,
        ratioB: record.ratioB,
      });
    }
  }

  #failChannel(record: RuntimeRecord, reason: string): void {
    record.consumerId = null;
    this.#transition(record, 'failed', reason);
  }

  /** CH-07/CH-08: SIGINT that consumer's group only (kill, not the record consumer's graceful EOS handoff — meeting/streaming outputs are not segmented). */
  async #finishDisable(id: ToggleableChannelId, consumerId: string | null): Promise<void> {
    const record = this.#records.get(id)!;
    if (consumerId) {
      try {
        await this.#deps.pm.stopConsumer(consumerId, { mode: 'kill' });
      } catch (error) {
        this.#deps.logger?.warn('channel disable: stop call failed', { error: describeError(error) });
      }
      await waitForExited(this.#deps.bus, this.#deps.clock, consumerId, TIMERS['T-CHANNEL-START']);
    }

    await this.#serial.run(() => {
      if (record.consumerId !== consumerId) return; // superseded by a later transition already handled
      if (record.channelId === 'streaming') {
        void (this.#deps.relay ?? NOOP_RELAY_ACTIVATOR).deactivate().catch((error: unknown) => {
          this.#deps.logger?.warn('channel disable: relay deactivate failed', { error: describeError(error) });
        });
      }
      if (record.sessionId) {
        closeActivation(this.#deps.db, this.#deps.clock, record.sessionId, record.channelId);
      }
      this.#transition(record, 'off', null);
      record.consumerId = null;
      record.sessionId = null;
      record.disableRequested = false;
    });
  }

  /** CH-09: an unexpected exit while `on` — auto-restart 3× with `T-CONSUMER-RESTART` backoff, then hold `failed` (INV-CC-2: only this channel's own consumer). */
  #onConsumerExitedUnexpectedly(consumerId: string): void {
    for (const record of this.#records.values()) {
      if (record.consumerId !== consumerId || record.state !== 'on') continue;

      const nowMs = this.#deps.clock.now().getTime();
      if (record.restartWindowStartMs === null || nowMs - record.restartWindowStartMs > RESTART_WINDOW_MS) {
        record.restartWindowStartMs = nowMs;
        record.restartAttempts = 0;
      }

      if (record.restartAttempts >= CONSUMER_RESTART_BACKOFF_MS.length) {
        this.#failChannel(record, 'channel.restart-budget-exhausted');
        continue;
      }

      const backoffMs = CONSUMER_RESTART_BACKOFF_MS[record.restartAttempts]!;
      record.restartAttempts += 1;
      record.consumerId = null;
      this.#transition(record, 'starting', 'channel.restarting');

      void this.#restartAfterBackoff(record, backoffMs).catch((error: unknown) => {
        this.#deps.logger?.warn('channel restart: relaunch failed unexpectedly', { error: describeError(error) });
      });
    }
  }

  async #restartAfterBackoff(record: RuntimeRecord, backoffMs: number): Promise<void> {
    await this.#deps.clock.sleep(backoffMs);
    let channel: ResolvedChannel;
    try {
      channel = resolveToggleableChannel(this.#deps.db, record.channelId);
    } catch (error) {
      await this.#serial.run(() => this.#failChannel(record, mapProblemReason(error)));
      return;
    }
    await this.#launchConsumer(record, channel);
  }

  #transition(record: RuntimeRecord, state: ChannelRuntimeState, reason: string | null): void {
    record.state = state;
    record.reason = reason;
    this.#deps.bus.publish('channel.state', this.#toPayload(record.channelId));
  }

  #toPayload(channelId: ToggleableChannelId): ChannelStatePayload {
    const record = this.#records.get(channelId)!;
    return {
      channelId: record.channelId,
      state: record.state,
      presetId: record.presetId as LayoutPresetId,
      ratioA: record.ratioA,
      ratioB: record.ratioB,
      reason: record.reason,
    };
  }

  #loadActiveSessionOrThrow(): typeof lectureSessions.$inferSelect {
    const session = this.#deps.db.select().from(lectureSessions).where(inArray(lectureSessions.state, NON_TERMINAL_STATES)).get();
    if (!session) {
      throw new ProblemError(409, 'session.not-active', 'No recording is active');
    }
    return session;
  }

  #accepted(): ChannelAccepted {
    const now = this.#deps.clock.now();
    return { commandId: this.#deps.ids.next(now), acceptedAt: now.toISOString(), resolveBySec: TIMERS['T-CMD-RESOLVE'] / 1000 };
  }
}

function assertToggleable(channelId: string): ToggleableChannelId {
  if (channelId === 'local') {
    throw new ProblemError(422, 'config.invalid', 'The local channel cannot be toggled — it is owned by the recording lifecycle');
  }
  if (channelId !== 'meeting' && channelId !== 'streaming') {
    throw new ProblemError(422, 'config.invalid', `Unknown channel: ${channelId}`);
  }
  return channelId;
}

/** Races `evt.pm.consumer.exited` (filtered by `consumerId`) against `timeoutMs`; a kill was already sent, so the timeout branch still proceeds — the switch must never read ON for a dead consumer. */
async function waitForExited(bus: DomainBus, clock: Clock, consumerId: string, timeoutMs: number): Promise<void> {
  const controller = new AbortController();
  let settled = false;

  await new Promise<void>((resolve) => {
    const finish = (): void => {
      if (settled) return;
      settled = true;
      unsubscribe();
      controller.abort();
      resolve();
    };

    const unsubscribe = bus.subscribe('evt.pm.consumer.exited', (payload) => {
      if (payload.consumerId !== consumerId) return;
      finish();
    });

    clock.sleep(timeoutMs, controller.signal).then(() => {
      if (controller.signal.aborted) return;
      finish();
    });
  });
}

function mapPmError(error: unknown): string {
  if (error instanceof PipelineManagerError) {
    return error.problem.code;
  }
  return `pm.unreachable: ${describeError(error)}`;
}

function mapProblemReason(error: unknown): string {
  if (error instanceof ProblemError) {
    return error.code;
  }
  return describeError(error);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
