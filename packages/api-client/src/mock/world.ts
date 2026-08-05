import { zEventEnvelope, type EventEnvelope, type PanelEventName } from '@eduscope/shared';
import { createEmitter, type EventStream, type Unsubscribe } from '../stream.js';
import { createWallClock, type Clock } from './clock.js';
import type { MachineDef, MachineId, Transition, TransitionId } from './machines/types.js';

export interface WorldOptions {
  readonly clock?: Clock;
  /** Scenario hook: return the id to run instead, or null to refuse entirely. */
  readonly intercept?: (id: TransitionId) => TransitionId | null;
}

/**
 * The mock's single source of truth: machine states + entity data + the emitter.
 * Deliberately a discrete-event simulation of docs/design/state-machines.md
 * rather than ad-hoc setTimeout soup — that is what makes scenarios composable.
 */
export class MockWorld {
  readonly clock: Clock;
  readonly data: Record<string, unknown> = {};

  private readonly machines = new Map<MachineId, MachineDef>();
  private readonly states = new Map<MachineId, string>();
  private readonly transitions = new Map<TransitionId, Transition>();
  private readonly emitter = createEmitter<EventEnvelope>();
  private readonly latest = new Map<string, EventEnvelope>();
  private readonly intercept: WorldOptions['intercept'];
  private seq = 0;

  constructor(options: WorldOptions = {}) {
    this.clock = options.clock ?? createWallClock();
    this.intercept = options.intercept;
  }

  registerMachine(def: MachineDef): void {
    this.machines.set(def.id, def);
    this.states.set(def.id, def.initial);
    for (const t of def.transitions) this.transitions.set(t.id, t);
  }

  state(machine: MachineId): string {
    const s = this.states.get(machine);
    if (s === undefined) throw new Error(`machine not registered: ${machine}`);
    return s;
  }

  subscribeEvents(listener: (e: EventEnvelope) => void): Unsubscribe {
    return this.emitter.subscribe(listener);
  }

  subscriberCount(): number {
    return this.emitter.size();
  }

  get events$(): EventStream<EventEnvelope> {
    return this.emitter;
  }

  /** events.md §1: on subscribe the server emits the current snapshot. */
  snapshot(): EventEnvelope[] {
    return [...this.latest.values()];
  }

  /**
   * Seed-only: sets a machine's current state directly, bypassing `apply()`'s
   * legality check and running no effects. A LIVE command must always go
   * through `apply()` — this exists only so bootstrap can start the world
   * already mid-lifecycle (e.g. a lecture already `recording`, owned by
   * someone else, for the locked-view states), which no legal single
   * transition reaches from `initial` and which must not carry a real
   * transition's `fire` effects (those would re-fire later against a state
   * they no longer agree with).
   */
  seedState(machine: MachineId, state: string): void {
    if (!this.states.has(machine)) throw new Error(`machine not registered: ${machine}`);
    this.states.set(machine, state);
  }

  schedule(id: TransitionId, afterMs: number): void {
    this.clock.setTimeout(() => {
      this.apply(id);
    }, afterMs);
  }

  apply(requested: TransitionId): void {
    const id = this.intercept ? this.intercept(requested) : requested;
    if (id === null) return; // refused by a scenario script
    const t = this.transitions.get(id);
    if (!t) throw new Error(`unknown transition: ${id}`);

    const current = this.state(t.machine);
    const legal = t.from.includes('*')
      ? !this.machines.get(t.machine)!.terminal.includes(current)
      : t.from.includes(current);
    if (!legal) {
      throw new Error(
        `illegal transition ${id}: from ${current}, expected one of ${t.from.join('|')}`,
      );
    }

    if (t.to !== null) this.states.set(t.machine, t.to);
    TRANSITION_DATA_REDUCERS[id]?.(this, t);
    for (const effect of t.effects) this.runEffect(effect, t);
  }

  emit(event: PanelEventName, payload: unknown): void {
    const envelope = zEventEnvelope.parse({
      event,
      at: this.clock.nowIso(),
      seq: this.seq++,
      payload,
    });
    this.latest.set(latestKey(envelope), envelope);
    this.emitter.emit(envelope);
  }

  private runEffect(effect: Transition['effects'][number], t: Transition): void {
    switch (effect.kind) {
      case 'set':
        this.data[effect.path] = effect.value;
        return;
      case 'fire':
        this.schedule(effect.transition, effect.afterMs);
        return;
      case 'emit': {
        const build = PAYLOAD_BUILDERS[effect.event];
        if (!build) throw new Error(`no payload builder registered for ${effect.event}`);
        this.emit(effect.event, { ...build(this, t), ...(effect.patch ?? {}) });
        return;
      }
      case 'alert':
        this.emit('system.alert', buildAlert(this, effect.code, effect.severity));
        return;
    }
  }
}

/**
 * `snapshot()` must return every distinct entity, not just the latest row per
 * event *name* — `sources.status` has one row per `SourceRoleId`, `channel.state`
 * one per `channelId`, `system.alert` one per alert `id`, `upload.job`/`export.job`
 * one per `jobId`, `quiz.publication` one per `publicationId`, `ai.question` one
 * per `questionId`. Fold whichever discriminator the payload carries into the
 * `latest` key so replaying/resyncing a "full snapshot" actually is one. Events
 * with none of these fields (`recording.state`, `storage.status`,
 * `device.health`, `quiz.session`, `ai.countdown`, `ai.set` — the doc's "(current)"
 * ones — …) fall back to a plain per-event singleton, same as before this fix.
 */
function latestKey(envelope: EventEnvelope): string {
  const payload = envelope.payload as Record<string, unknown>;
  const discriminator =
    payload.roleId ??
    payload.channelId ??
    payload.id ??
    payload.jobId ??
    payload.publicationId ??
    payload.questionId;
  return typeof discriminator === 'string' ? `${envelope.event}:${discriminator}` : envelope.event;
}

/** Per-event payload builders; each machine module registers its own on import. */
export const PAYLOAD_BUILDERS: Partial<
  Record<PanelEventName, (w: MockWorld, t: Transition) => Record<string, unknown>>
> = {};

/**
 * Transition-local persisted-data updates that cannot be represented by a
 * static `set` effect (timestamps, counters and accumulated durations).
 * Registered beside the owning machine, before any world applies it.
 */
export const TRANSITION_DATA_REDUCERS: Partial<
  Record<TransitionId, (w: MockWorld, t: Transition) => void>
> = {};

export function buildAlert(
  w: MockWorld,
  code: string,
  severity: 'info' | 'warning' | 'error',
): Record<string, unknown> {
  return {
    id: nextUlid(w),
    code,
    severity,
    category: 'System',
    title: code,
    detail: null,
    // zSystemAlert.raisedAt is z.string().datetime() (Z-only, no offset), but
    // Clock.nowIso() always returns a "+00:00"-suffixed instant — normalize.
    raisedAt: w.clock.nowIso().replace('+00:00', 'Z'),
    clearedAt: null,
    clearedReason: null,
    acknowledgedBy: null,
    context: null,
    relatedEntity: null,
  };
}

const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let ulidCounter = 0;

/** Deterministic ULID-shaped ids — tests must not depend on randomness. */
export function nextUlid(w: MockWorld): string {
  const time = Math.floor(w.clock.now() / 1000)
    .toString(32)
    .toUpperCase();
  const rand = (ulidCounter++).toString(32).toUpperCase();
  const raw = (time + rand.padStart(16, '0')).padEnd(26, '0').slice(0, 26);
  return [...raw].map((c) => (ULID_ALPHABET.includes(c) ? c : '0')).join('');
}
