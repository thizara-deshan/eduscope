import type { SourceRoleId } from '@eduscope/shared';
import { PAYLOAD_BUILDERS, type MockWorld } from '../world.js';
import { alert, emit, fire, t } from './helpers.js';
import type { MachineDef, MachineId, Transition, TransitionId } from './types.js';

/**
 * Machine 5 — DEVICE / SOURCE HEALTH: 5a per-`SourceRole` health (one
 * `MachineDef` instance per bound role, factory-style), 5b storage pressure,
 * and 5c the capture-card watchdog (a fourth, standalone `captureCardMachine`
 * — see index.ts's module comment for why it exists and for the `HL-xx` id
 * scheme this factory uses; use `sourceTransitionId()` below rather than
 * hand-building ids).
 */

// ── 5a — per-SourceRole health ──────────────────────────────────────────────

const citeA = (n: string) => `state-machines §6.1 ${n}`;

/**
 * V1 binds four roles; `mic-room` stays `unbound` forever (INV-SR-2, A-08
 * amended) — see index.ts's `BOUND_SOURCE_ROLES`. `presentation` is the
 * canonical role (`BOUND_SOURCE_ROLES[0]`) and keeps the bare `HL-xx` ids;
 * see `sourceTransitionId()` and index.ts's module comment for the scheme.
 */
export const CANONICAL_SOURCE_ROLE: SourceRoleId = 'presentation';

/**
 * Resolve a *bare* doc id (`'HL-02'`) to the id actually registered for a
 * given role — `'HL-02'` for `presentation`, `'HL-02@lecturer-cam'` for
 * every other bound role.
 */
export function sourceTransitionId(roleId: SourceRoleId, bareId: string): TransitionId {
  return roleId === CANONICAL_SOURCE_ROLE ? bareId : `${bareId}@${roleId}`;
}

export function sourceMachine(roleId: SourceRoleId): MachineDef {
  const id: MachineId = `source:${roleId}`;
  const hlId = (n: string) => sourceTransitionId(roleId, n);

  return {
    id,
    initial: 'unknown',
    terminal: [],
    transitions: [
      t(id, hlId('HL-01'), ['unknown'], 'unbound', citeA('HL-01'),
        emit('sources.status', { state: 'unbound' })),

      t(id, hlId('HL-09'), ['unbound'], 'unknown', citeA('HL-09'),
        emit('sources.status', { state: 'unknown' })),

      t(id, hlId('HL-02'), ['unknown', 'offline'], 'online', citeA('HL-02'),
        emit('sources.status', { state: 'online' })),

      t(id, hlId('HL-03'), ['unknown'], 'offline', citeA('HL-03'),
        emit('sources.status', { state: 'offline' })),

      t(id, hlId('HL-04'), ['online'], 'degraded', citeA('HL-04'),
        emit('sources.status', { state: 'degraded' }),
        alert('source.degraded', 'warning')),

      t(id, hlId('HL-05'), ['degraded'], 'online', citeA('HL-05'),
        emit('sources.status', { state: 'online' }),
        alert('cleared', 'info')),

      t(id, hlId('HL-06'), ['online', 'degraded'], 'offline', citeA('HL-06'),
        emit('sources.status', { state: 'offline' }),
        alert('source.offline', 'warning')),

      t(id, hlId('HL-07'), ['offline'], 'online', citeA('HL-07'),
        emit('sources.status', { state: 'online' }),
        alert('cleared', 'info')),

      // Doc's "any" — never surface a stale last-known value (INV-DH-2, B-12).
      t(id, hlId('HL-08'), ['*'], 'unknown', citeA('HL-08'),
        emit('sources.status', { state: 'unknown' })),
    ],
  };
}

PAYLOAD_BUILDERS['sources.status'] = (w: MockWorld, tr: Transition) => {
  const roleId = tr.machine.startsWith('source:') ? tr.machine.slice('source:'.length) : 'presentation';
  return {
    roleId,
    state: w.state(tr.machine),
    detail: (w.data[`source.${roleId}.detail`] as string | undefined) ?? null,
    since: w.clock.nowIso(),
    inputId: (w.data[`source.${roleId}.inputId`] as string | undefined) ?? null,
  };
};

// ── 5b — storage pressure (LP-12, [D-15]) ───────────────────────────────────

const M_STORAGE = 'storage' as const;
const citeB = (n: string) => `state-machines §6.3 ${n}`;

export const storageMachine: MachineDef = {
  id: M_STORAGE,
  initial: 'ok',
  terminal: [],
  transitions: [
    t(M_STORAGE, 'HL-10', ['ok'], 'warning', citeB('HL-10'),
      emit('storage.status'),
      alert('storage.warning', 'warning')),

    t(M_STORAGE, 'HL-11', ['warning'], 'ok', citeB('HL-11'),
      emit('storage.status'),
      alert('cleared', 'info')),

    t(M_STORAGE, 'HL-12', ['warning'], 'critical', citeB('HL-12'),
      emit('storage.status'),
      alert('storage.critical', 'error')),

    t(M_STORAGE, 'HL-13', ['critical'], 'warning', citeB('HL-13'),
      emit('storage.status')),

    t(M_STORAGE, 'HL-14', ['critical'], null, citeB('HL-14'),
      alert('storage.critical', 'error'),
      emit('recording.state')),
  ],
};

const DEFAULT_RETENTION_POLICY = {
  maxAgeDays: 90,
  warningThresholdPct: 70,
  criticalThresholdPct: 90,
  earlyDeleteOrder: 'uploaded-oldest-first' as const,
  neverDeleteUnuploaded: true,
  refuseStartWhenCritical: true,
};

PAYLOAD_BUILDERS['storage.status'] = (w: MockWorld) => ({
  pressure: w.state(M_STORAGE),
  freeBytes: (w.data['storage.freeBytes'] as number | undefined) ?? 50_000_000_000,
  totalBytes: (w.data['storage.totalBytes'] as number | undefined) ?? 500_000_000_000,
  policy: (w.data['storage.policy'] as Record<string, unknown> | undefined) ?? DEFAULT_RETENTION_POLICY,
});

// ── 5c — capture-card watchdog (PF-13, B-39) ────────────────────────────────

const M_CAPTURE = 'capture-card' as const;
const citeC = (n: string) => `state-machines §6.4 ${n}`;

export const captureCardMachine: MachineDef = {
  id: M_CAPTURE,
  initial: 'present',
  terminal: ['failed'],
  transitions: [
    t(M_CAPTURE, 'HL-20', ['present'], 'absent', citeC('HL-20'),
      emit('device.health', { captureCardState: 'absent' }),
      alert('capture-card.absent', 'error')),

    t(M_CAPTURE, 'HL-21', ['absent'], 'recovering', citeC('HL-21'),
      emit('device.health', { captureCardState: 'recovering' }),
      fire('HL-22', 1_500)),

    t(M_CAPTURE, 'HL-22', ['recovering'], 'present', citeC('HL-22'),
      emit('device.health', { captureCardState: 'present' }),
      alert('cleared', 'info')),

    t(M_CAPTURE, 'HL-23', ['recovering'], 'failed', citeC('HL-23'),
      emit('device.health', { captureCardState: 'failed' }),
      alert('capture-card.failed', 'error')),
  ],
};

PAYLOAD_BUILDERS['device.health'] = (w: MockWorld) => ({
  captureCardState: w.state(M_CAPTURE),
  publisherStates: (w.data['device.publisherStates'] as Record<string, unknown> | undefined) ?? {},
  ntpSynced: (w.data['device.ntpSynced'] as boolean | undefined) ?? true,
  clockOffsetMs: (w.data['device.clockOffsetMs'] as number | undefined) ?? 0,
  diskHealth: (w.data['device.diskHealth'] as string | undefined) ?? 'good',
  lastBootAt: (w.data['device.lastBootAt'] as string | undefined) ?? w.clock.nowIso(),
});
