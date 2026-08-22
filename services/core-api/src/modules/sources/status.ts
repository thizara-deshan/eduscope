import { TIMERS, type SourceHealthState, type SourceRoleId, type SourcesStatusPayload } from '@eduscope/shared';
import { eq } from 'drizzle-orm';
import type { DrizzleDb } from '../../db/client.js';
import { physicalInputs, sourceBindings, sourceRoles } from '../../db/schema.js';
import type { Cancel, Clock } from '../../lib/clock.js';
import type { DomainBus, Unsubscribe } from '../../lib/domain-bus.js';
import type { LifecycleComponent, LifecycleStopReason } from '../../lifecycle.js';
import type { PmPublisherId, PmPublisherState, PmStatus } from '../recording/pm/types.js';
import { AudioLevelThrottle } from './telemetry.js';

/** pipeline-manager.md §1.1 — the only four provisionable, publisher-backed roles (INV-SR-2: `mic-room` is permanently `unbound`). */
export const PM_PUBLISHER_TO_ROLE: Record<PmPublisherId, SourceRoleId> = {
  usb: 'presentation',
  rtsp: 'lecturer-cam',
  rtsp2: 'students-cam',
  audio: 'mic-lecturer',
};

export type SourceObservation =
  | { kind: 'binding'; roleId: SourceRoleId; bound: boolean; inputId: string | null }
  | { kind: 'telemetry'; roleId: SourceRoleId; publisherState: PmPublisherState };

export interface SourceTransition {
  roleId: SourceRoleId;
  payload: SourcesStatusPayload;
}

interface RoleRecord {
  state: SourceHealthState;
  detail: string | null;
  since: Date;
  inputId: string | null;
  /** Pending debounce: the raw state we're waiting `T-SOURCE-*` out before committing (HL-02/04/05/06). */
  candidate: SourceHealthState | null;
  candidateTimer: Cancel | null;
  staleTimer: Cancel | null;
}

/** A single-fire, cancellable delay — `Clock.every` is a repeating interval, so one-shot debounce/staleness timers wrap `sleep`+`AbortController` instead (the same idiom as `RecordingExecutor#armConfirmRace`). */
function oneShot(clock: Clock, ms: number, run: () => void): Cancel {
  const controller = new AbortController();
  clock.sleep(ms, controller.signal).then(() => {
    if (!controller.signal.aborted) run();
  });
  return { cancel: () => controller.abort() };
}

/**
 * Machine 5a (state-machines.md §6.1): the only writer of per-role source
 * health. Truth is pipeline-manager telemetry; this class projects it through
 * the HL-01..HL-09 debounce table so a single noisy reading never flaps the
 * panel, and telemetry silence always decays to `unknown` — never the
 * last-healthy value (`T-HEALTH-STALE`, INV-DH-2).
 */
export class SourceProjection {
  readonly #clock: Clock;
  readonly #records = new Map<SourceRoleId, RoleRecord>();
  readonly #onTransition: (transition: SourceTransition) => void;

  constructor(clock: Clock, onTransition: (transition: SourceTransition) => void) {
    this.#clock = clock;
    this.#onTransition = onTransition;
  }

  /** Seeds a role's starting record (HL-01 if unbound, `[*] --> unknown` otherwise) without emitting — call once at startup per role before any observation arrives. */
  seed(roleId: SourceRoleId, bound: boolean, inputId: string | null): void {
    const now = this.#clock.now();
    this.#records.set(roleId, {
      state: bound ? 'unknown' : 'unbound',
      detail: null,
      since: now,
      inputId: bound ? inputId : null,
      candidate: null,
      candidateTimer: null,
      staleTimer: null,
    });
  }

  snapshot(): SourcesStatusPayload[] {
    return [...this.#records.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([roleId, record]) => this.#toPayload(roleId, record));
  }

  observePmEvent(observation: SourceObservation): void {
    const record = this.#records.get(observation.roleId);
    if (!record) return;

    if (observation.kind === 'binding') {
      this.#cancelTimers(record);
      if (observation.bound) {
        // HL-09: re-probe on admin rebind — always unknown, never last-healthy.
        this.#commit(observation.roleId, record, 'unknown', null, observation.inputId);
      } else {
        // HL-01: no enabled binding.
        this.#commit(observation.roleId, record, 'unbound', null, null);
      }
      return;
    }

    if (record.state === 'unbound') return; // HL-01 only leaves via HL-09 (binding), never telemetry.

    this.#armStaleTimer(observation.roleId, record);

    const raw = observation.publisherState;
    if (raw === 'unknown') {
      // pipeline-manager itself is uncertain about this role right now — INV-DH-2 forbids
      // continuing to show the last-healthy value while waiting out T-HEALTH-STALE for it.
      record.candidateTimer?.cancel();
      record.candidateTimer = null;
      record.candidate = null;
      if (record.state !== 'unknown') {
        this.#commit(observation.roleId, record, 'unknown', null, record.inputId);
      }
      return;
    }

    const target: SourceHealthState = raw; // PmPublisherState's 'online'|'degraded'|'offline' align 1:1 with SourceHealthState here.
    if (target === record.state) {
      // Steady state: a matching reading cancels any stale candidate for a *different* target.
      if (record.candidate !== null && record.candidate !== target) {
        record.candidateTimer?.cancel();
        record.candidate = null;
        record.candidateTimer = null;
      }
      return;
    }
    if (record.candidate === target) return; // already debouncing toward this candidate — let the running timer finish.

    record.candidateTimer?.cancel();
    record.candidate = target;

    // HL-03: unknown -> offline is immediate (no debounce — nothing was ever flowing to hold onto).
    if (record.state === 'unknown' && target === 'offline') {
      record.candidate = null;
      this.#commit(observation.roleId, record, 'offline', 'publisher not running', record.inputId);
      return;
    }

    const debounceMs = target === 'online' ? TIMERS['T-SOURCE-DEBOUNCE'] : target === 'degraded' ? TIMERS['T-SOURCE-DEGRADE'] : TIMERS['T-SOURCE-OFFLINE'];
    record.candidateTimer = oneShot(this.#clock, debounceMs, () => {
      record.candidateTimer = null;
      const committed = record.candidate;
      record.candidate = null;
      if (committed !== null) {
        this.#commit(observation.roleId, record, committed, null, record.inputId);
      }
    });
  }

  #armStaleTimer(roleId: SourceRoleId, record: RoleRecord): void {
    record.staleTimer?.cancel();
    record.staleTimer = oneShot(this.#clock, TIMERS['T-HEALTH-STALE'], () => {
      record.staleTimer = null;
      record.candidateTimer?.cancel();
      record.candidateTimer = null;
      record.candidate = null;
      if (record.state !== 'unknown' && record.state !== 'unbound') {
        this.#commit(roleId, record, 'unknown', null, record.inputId);
      }
    });
  }

  #commit(roleId: SourceRoleId, record: RoleRecord, state: SourceHealthState, detail: string | null, inputId: string | null): void {
    record.state = state;
    record.detail = detail;
    record.since = this.#clock.now();
    record.inputId = inputId;
    this.#onTransition({ roleId, payload: this.#toPayload(roleId, record) });
  }

  /** Cancels every pending per-role timer — called on service shutdown. */
  dispose(): void {
    for (const record of this.#records.values()) {
      this.#cancelTimers(record);
    }
  }

  #cancelTimers(record: RoleRecord): void {
    record.candidateTimer?.cancel();
    record.candidateTimer = null;
    record.candidate = null;
    record.staleTimer?.cancel();
    record.staleTimer = null;
  }

  #toPayload(roleId: SourceRoleId, record: RoleRecord): SourcesStatusPayload {
    return { roleId, state: record.state, detail: record.detail, since: record.since.toISOString(), inputId: record.inputId };
  }
}

/** `SourceHealthState` -> `PhysicalInput.presenceState` (schema.ts) — `error` has no HL trigger in V1, so it is never written here. */
function toPresenceState(state: SourceHealthState): 'present' | 'absent' | 'unknown' {
  if (state === 'online' || state === 'degraded') return 'present';
  if (state === 'offline') return 'absent';
  return 'unknown';
}

export interface SourceExecutorDeps {
  db: DrizzleDb;
  clock: Clock;
  bus: DomainBus;
}

/**
 * Owns the machine-5a projection's wiring: seeds it from `source_bindings` at
 * startup, feeds it pipeline-manager publisher telemetry off `pm.status.resynced`
 * (the one full-snapshot event the bridge already publishes — B-04), persists
 * `physical_inputs.presence_state` on every committed transition, and fans out
 * `sources.status`/`audio.levels` on the domain bus. `reprobe()` is B-11's HL-09
 * hook: a binding write calls back in here so a role is re-probed in exactly
 * one place (INV-PI-2).
 */
export class SourceExecutor implements LifecycleComponent {
  readonly name = 'source-executor';

  readonly #deps: SourceExecutorDeps;
  readonly #projection: SourceProjection;
  readonly #audio: AudioLevelThrottle;
  #unsubscribeResynced: Unsubscribe | null = null;

  constructor(deps: SourceExecutorDeps) {
    this.#deps = deps;
    this.#projection = new SourceProjection(deps.clock, (transition) => this.#onTransition(transition));
    this.#audio = new AudioLevelThrottle(deps.clock);
  }

  async start(): Promise<void> {
    const roles = this.#deps.db.select({ id: sourceRoles.id }).from(sourceRoles).all();
    const bindings = this.#deps.db.select().from(sourceBindings).all();
    const bindingByRole = new Map(bindings.map((binding) => [binding.roleId, binding]));

    for (const role of roles) {
      const binding = bindingByRole.get(role.id);
      const bound = binding?.enabled === true && binding.physicalInputId !== null;
      this.#projection.seed(role.id, bound, bound ? binding!.physicalInputId : null);
    }

    this.#unsubscribeResynced = this.#deps.bus.subscribe('pm.status.resynced', (status) => this.#onPmStatus(status));
  }

  async stop(_reason: LifecycleStopReason): Promise<void> {
    this.#unsubscribeResynced?.();
    this.#unsubscribeResynced = null;
    this.#projection.dispose();
  }

  getStatus(): SourcesStatusPayload[] {
    return this.#projection.snapshot();
  }

  /** B-11's HL-09 hook: `cmd.admin.set_binding` calls this exactly once after its own transaction commits. */
  reprobe(roleId: SourceRoleId, bound: boolean, inputId: string | null): void {
    this.#projection.observePmEvent({ kind: 'binding', roleId, bound, inputId });
  }

  #onPmStatus(status: PmStatus): void {
    for (const [publisherId, roleId] of Object.entries(PM_PUBLISHER_TO_ROLE) as [PmPublisherId, SourceRoleId][]) {
      const publisher = status.publishers[publisherId];
      if (!publisher) continue;
      this.#projection.observePmEvent({ kind: 'telemetry', roleId, publisherState: publisher.state });
      this.#maybePublishAudioLevel(roleId, publisher.rms);
    }
  }

  /** §2.6/§6 budget: no `audio.levels` work at all while nothing is subscribed on the bus (the panel's kiosk browser shares the board with the pipelines). */
  #maybePublishAudioLevel(roleId: SourceRoleId, rms: number | null): void {
    if (rms === null) return;
    if (this.#deps.bus.listenerCount('audio.levels') === 0) return;
    const payload = this.#audio.next(roleId, rms);
    if (payload) {
      this.#deps.bus.publish('audio.levels', payload);
    }
  }

  #onTransition(transition: SourceTransition): void {
    const { payload } = transition;
    if (payload.inputId) {
      const set: { presenceState: 'present' | 'absent' | 'unknown'; updatedAt: string; lastSeenAt?: string } = {
        presenceState: toPresenceState(payload.state),
        updatedAt: this.#deps.clock.now().toISOString(),
      };
      if (payload.state === 'online') set.lastSeenAt = payload.since;
      this.#deps.db.update(physicalInputs).set(set).where(eq(physicalInputs.id, payload.inputId)).run();
    }
    this.#deps.bus.publish('sources.status', payload);
  }
}
