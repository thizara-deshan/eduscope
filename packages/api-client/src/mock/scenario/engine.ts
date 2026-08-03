import type { Problem } from '@eduscope/shared';
import type { TransitionId } from '../machines/types.js';
import type { ForcedTransition, ScenarioScript, TraceEntry } from './types.js';

export interface ScenarioEngine {
  /** Passed to MockWorld as `intercept` — every apply() funnels through here. */
  intercept(id: TransitionId): TransitionId | null;
  /** Called by each mock REST method before it runs its CommandPlan. */
  onCommand(operationId: string): Problem | null;
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
      const hit = match((f) => 'command' in f.on && f.on.command === operationId);
      if (!hit || hit.rule.replace !== 'refuse') return null;
      return (
        hit.rule.refusal ?? {
          status: 409,
          code: 'conflict',
          title: `Refused by scenario "${script.name}"`,
        }
      );
    },

    trace: () => log,

    reset() {
      counts = new Map();
      log = [];
    },
  };
}
