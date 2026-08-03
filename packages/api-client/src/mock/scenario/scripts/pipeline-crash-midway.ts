import type { ScenarioScript } from '../types.js';

/**
 * R-16: the consumer dies mid-lecture, a NEW segment opens, and the lecture is
 * not ended by a dead pipeline. `nth: 1` keeps it a one-off event, not a loop.
 */
export const pipelineCrashMidway: ScenarioScript = {
  name: 'pipeline-crash-midway',
  description:
    'Forty seconds in, the record consumer exits unexpectedly. R-16 truncates the ' +
    'open segment, raises recording.pipeline-lost, and R-17 resumes into a new ' +
    'segment — the seam is visible, the lecture survives.',
  forced: [
    { on: { transition: 'R-05' }, nth: 1, replace: 'R-05', delayMs: 1_200 },
    { on: { transition: 'R-16' }, nth: 1, replace: 'R-16' },
  ],
};
