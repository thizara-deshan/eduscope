import { happy } from './scripts/happy.js';
import { startFails } from './scripts/start-fails.js';
import { pipelineCrashMidway } from './scripts/pipeline-crash-midway.js';
import { llmTimeout } from './scripts/llm-timeout.js';
import { diskFull } from './scripts/disk-full.js';
import { wsFlap } from './scripts/ws-flap.js';
import { quizNetworkLoss } from './scripts/quiz-network-loss.js';
import type { ForcedTransition, ScenarioName, ScenarioScript } from './types.js';

/** The catalog, in overlay display order. Extend the scripts; never fork them. */
const CATALOG: Record<ScenarioName, ScenarioScript> = {
  happy,
  'start-fails': startFails,
  'pipeline-crash-midway': pipelineCrashMidway,
  'llm-timeout': llmTimeout,
  'disk-full': diskFull,
  'ws-flap': wsFlap,
  'quiz-network-loss': quizNetworkLoss,
};

export function getScenario(name: ScenarioName): ScenarioScript {
  const script = CATALOG[name];
  if (!script) throw new Error(`unknown scenario: ${String(name)}`);
  return script;
}

export function listScenarios(): readonly ScenarioScript[] {
  return Object.values(CATALOG);
}

/**
 * The screen-facing extension point (frontend-conventions §4). A screen that
 * needs a state the catalog cannot reach appends a rule here — it does not
 * define a new script. Rules match in registration order, first match wins.
 */
export function extendScenario(name: ScenarioName, ...forced: ForcedTransition[]): void {
  getScenario(name).forced.push(...forced);
}

export { createScenarioEngine } from './engine.js';
export type * from './types.js';
