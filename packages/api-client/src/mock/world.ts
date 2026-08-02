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
  private readonly latest = new Map<PanelEventName, EventEnvelope>();
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

  get events$(): EventStream<EventEnvelope> {
    return this.emitter;
  }

  /** events.md §1: on subscribe the server emits the current snapshot. */
  snapshot(): EventEnvelope[] {
    return [...this.latest.values()];
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
    for (const effect of t.effects) this.runEffect(effect, t);
  }

  emit(event: PanelEventName, payload: unknown): void {
    const envelope = zEventEnvelope.parse({
      event,
      at: this.clock.nowIso(),
      seq: this.seq++,
      payload,
    });
    this.latest.set(event, envelope);
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
        // A machine's transitions may re-broadcast another machine's event as
        // an informational snapshot (e.g. recording.ts's R-05 re-emits
        // ai.countdown/quiz.session alongside its own state change). Tests
        // that register a single machine in isolation (world.test.ts +
        // recordingMachine) legitimately never load the module that owns
        // that builder — skip rather than crash; createMockClient registers
        // every machine (and therefore every builder) together in practice.
        if (!build) return;
        this.emit(effect.event, { ...build(this, t), ...(effect.patch ?? {}) });
        return;
      }
      case 'alert':
        this.emit('system.alert', buildAlert(this, effect.code, effect.severity));
        return;
    }
  }
}

/** Per-event payload builders; each machine module registers its own on import. */
export const PAYLOAD_BUILDERS: Partial<
  Record<PanelEventName, (w: MockWorld, t: Transition) => Record<string, unknown>>
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
    raisedAt: w.clock.nowIso(),
    acknowledgedAt: null,
    clearedAt: null,
    clearedReason: null,
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
