import { sourceTransitionId } from '../../machines/health.js';
import type { ScenarioScript } from '../types.js';

/**
 * R-16 plus the source faults every Wave-2 confidence surface needs.
 *
 * The consumer dies mid-lecture, a NEW segment opens, and the lecture is not
 * ended by a dead pipeline. Alongside it the timeline walks machine 5a through
 * degraded -> offline on `lecturer-cam`, and offline on `mic-lecturer` — the
 * audio role §6.2 ranks CRITICAL ("a silent lecture is bad, so this is
 * impossible to miss") and that no script exercised before (S-11 §10). Both
 * recover, so the demo ends healthy rather than dead-ending. Delays are
 * demo-sized, not spec-length.
 */
export const pipelineCrashMidway: ScenarioScript = {
  name: 'pipeline-crash-midway',
  description:
    'The record consumer exits unexpectedly: R-16 truncates the open segment, raises ' +
    'recording.pipeline-lost, and R-17 resumes into a new segment — the seam is visible, ' +
    'the lecture survives. Meanwhile the lecturer camera degrades then drops, and the ' +
    'lecturer mic drops: a dead source never ends a lecture (R-SRC-1).',
  forced: [
    { on: { transition: 'R-05' }, nth: 1, replace: 'R-05', delayMs: 1_200 },
    { on: { transition: 'R-16' }, nth: 1, replace: 'R-16' },
  ],
  timeline: [
    { transition: sourceTransitionId('lecturer-cam', 'HL-04'), afterMs: 5_000 },
    { transition: sourceTransitionId('lecturer-cam', 'HL-06'), afterMs: 12_000 },
    { transition: sourceTransitionId('mic-lecturer', 'HL-06'), afterMs: 20_000 },
    { transition: sourceTransitionId('lecturer-cam', 'HL-07'), afterMs: 34_000 },
    { transition: 'R-16', afterMs: 40_000 },
    { transition: sourceTransitionId('mic-lecturer', 'HL-07'), afterMs: 40_000 },
  ],
};
