import type { Problem } from '@eduscope/shared';
import type { TransitionId } from '../machines/types.js';
import type { ForcedTransition, ScenarioScript, TraceEntry } from './types.js';

export interface ScenarioEngine {
  /** Passed to MockWorld as `intercept` — every apply() funnels through here. */
  intercept(id: TransitionId): TransitionId | null;
  /** Called by each mock REST method before it runs its CommandPlan. */
  onCommand(operationId: string): Problem | null;
  /**
   * Transport-layer fault, checked by the REST proxy BEFORE the operation runs.
   * Separate from `onCommand` because a transport failure has no Problem body
   * (see errors.ts TransportError). Returns how long to fail after, or null.
   */
  onTransport(operationId: string): { delayMs: number } | null;
  /**
   * `replace: 'stall'` — the command is accepted normally but its usual
   * resolving side effect must be suppressed (v0.3, CG-16). Checked by the
   * operation itself, not the generic `accept()` helper, since which side
   * effect counts as "resolving" is operation-specific (powerOffDevice: the
   * transport closing).
   */
  onStall(operationId: string): boolean;
  trace(): readonly TraceEntry[];
  reset(): void;
  readonly script: ScenarioScript;
}

export function createScenarioEngine(script: ScenarioScript): ScenarioEngine {
  let counts = new Map<number, number>();
  let log: TraceEntry[] = [];
  const nowIso = () => new Date().toISOString().replace('Z', '+00:00');

  function match(
    predicate: (f: ForcedTransition) => boolean,
  ): { rule: ForcedTransition; index: number } | null {
    for (const [index, rule] of script.forced.entries()) {
      if (!predicate(rule)) continue;
      const seen = (counts.get(index) ?? 0) + 1;
      counts.set(index, seen);
      if (rule.nth !== undefined && rule.nth !== seen) continue;
      return { rule, index }; // first match wins — registration order is priority
    }
    return null;
  }

  return {
    script,

    intercept(id) {
      const hit = match((f) => 'transition' in f.on && f.on.transition === id);
      if (!hit) {
        log.push({ at: nowIso(), requested: id, applied: id, ruleIndex: null });
        return id;
      }
      const applied = hit.rule.replace === 'refuse' ? null : hit.rule.replace;
      log.push({ at: nowIso(), requested: id, applied, ruleIndex: hit.index });
      return applied;
    },

    onCommand(operationId) {
      // `f.replace === 'refuse'` is part of the PREDICATE, not a post-filter:
      // match() consumes an `nth` the moment its predicate passes, so a rule
      // filtered afterwards would still have burned its own occurrence here and
      // never fired in onTransport. No existing script pairs a command trigger
      // with a TransitionId replacement, so narrowing this changes no behaviour.
      const hit = match(
        (f) => 'command' in f.on && f.on.command === operationId && f.replace === 'refuse',
      );
      if (!hit) return null;
      return (
        hit.rule.refusal ?? {
          status: 409,
          code: 'conflict',
          title: `Refused by scenario "${script.name}"`,
        }
      );
    },

    onTransport(operationId) {
      const hit = match(
        (f) => 'command' in f.on && f.on.command === operationId && f.replace === 'unreachable',
      );
      return hit ? { delayMs: hit.rule.delayMs ?? 0 } : null;
    },

    onStall(operationId) {
      return match(
        (f) => 'command' in f.on && f.on.command === operationId && f.replace === 'stall',
      ) !== null;
    },

    trace: () => log,

    reset() {
      counts = new Map();
      log = [];
    },
  };
}
