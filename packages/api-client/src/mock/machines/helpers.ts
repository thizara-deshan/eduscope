import type { PanelEventName } from '@eduscope/shared';
import type { Effect, MachineId, Transition, TransitionId } from './types.js';

/** Terse constructor so a transition table reads like the doc's table. */
export function t(
  machine: MachineId,
  id: TransitionId,
  from: readonly string[],
  to: string | null,
  cite: string,
  ...effects: Effect[]
): Transition {
  return { id, machine, from, to, cite, effects };
}

export const emit = (
  event: PanelEventName,
  patch?: Record<string, unknown>,
): Effect => ({ kind: 'emit', event, ...(patch ? { patch } : {}) });

export const fire = (transition: TransitionId, afterMs: number): Effect => ({
  kind: 'fire',
  transition,
  afterMs,
});

export const alert = (
  code: string,
  severity: 'info' | 'warning' | 'error',
): Effect => ({ kind: 'alert', code, severity });

export const set = (path: string, value: unknown): Effect => ({
  kind: 'set',
  path,
  value,
});
