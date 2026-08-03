import type { ScenarioScript } from '../types.js';

/**
 * Class B (state-machines §0.4): the session IS created and then fails to `error`
 * — a start that fails must never read as `recording` (B-12, LP-4, J-1 failure).
 */
export const startFails: ScenarioScript = {
  name: 'start-fails',
  description:
    'The record consumer never confirms. R-05 is replaced by R-06, so the session ' +
    'goes starting -> error with a named cause; the red frame never appears.',
  forced: [{ on: { transition: 'R-05' }, replace: 'R-06' }],
};
