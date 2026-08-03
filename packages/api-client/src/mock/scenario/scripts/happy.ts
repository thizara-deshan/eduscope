import type { ScenarioScript } from '../types.js';

/**
 * The spec path, unmodified. `happy` is deliberately EMPTY: the default command
 * plans plus each transition's own `fire` effects already reproduce the documented
 * timings, so there is nothing to force. If a demo needs a rule here, the machine
 * definition is wrong — fix the machine, not the scenario.
 */
export const happy: ScenarioScript = {
  name: 'happy',
  description:
    'Everything works: start confirms, the AI countdown arms, the quiz session opens, ' +
    'stop finalizes to a playable recording. J-1 and J-2 happy paths.',
  forced: [],
};
