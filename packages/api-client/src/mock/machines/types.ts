import type { PanelEventName } from '@eduscope/shared';

/** One runtime machine instance. Channel and source machines are per-id. */
export type MachineId =
  | 'recording'
  | `channel:${'meeting' | 'streaming'}`
  | 'ai.countdown'
  | 'ai.set'
  | 'ai.publication'
  | 'quiz.session'
  | 'quiz.sync'
  | `source:${string}`
  | 'storage';

/** Stable ids from docs/design/state-machines.md — 'R-01', 'CH-05', 'Q-12', … */
export type TransitionId = string;

export type Effect =
  /** Emit a catalog event; `patch` is merged over the machine's payload builder. */
  | { readonly kind: 'emit'; readonly event: PanelEventName; readonly patch?: Record<string, unknown> }
  /** Mutate world data (session title, segment index, joined count, …). */
  | { readonly kind: 'set'; readonly path: string; readonly value: unknown }
  /** Queue a follow-on transition — this is how "realistic delays" are expressed. */
  | { readonly kind: 'fire'; readonly transition: TransitionId; readonly afterMs: number }
  /** Raise a system.alert row (INV-SA-1: a still-true condition re-raises). */
  | { readonly kind: 'alert'; readonly code: string; readonly severity: 'info' | 'warning' | 'error' };

export interface Transition {
  readonly id: TransitionId;
  readonly machine: MachineId;
  /** Legal source states. `'*'` = any non-terminal state (R-21, R-22). */
  readonly from: readonly string[];
  /** Target state, or `null` for self-transitions that only emit (R-20, R-21). */
  readonly to: string | null;
  readonly effects: readonly Effect[];
  /** Citation, e.g. 'state-machines §1.2 R-05'. Rendered in the scenario overlay. */
  readonly cite: string;
}

export interface MachineDef {
  readonly id: MachineId;
  readonly initial: string;
  readonly terminal: readonly string[];
  readonly transitions: readonly Transition[];
}
