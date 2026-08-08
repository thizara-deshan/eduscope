import type { ScenarioScript } from '../types.js';

/**
 * W3-D-3 — the Wave-3 output failure states, grouped on one script rather
 * than a generic fault framework: a meeting consumer that fails to start, a
 * streaming preflight failure that leaves recording untouched, and
 * configuration saves that demonstrate a delayed transport failure then a
 * named rejection before recovering. `happy` remains untouched.
 */
export const channelFailures: ScenarioScript = {
  name: 'channel-failures',
  description:
    'Output failures: a meeting consumer fails to start, streaming preflight fails without stopping the recording, and configuration saves demonstrate delayed transport failure then a named rejection before recovering.',
  forced: [
    { on: { transition: 'CH-05' }, nth: 1, replace: 'CH-06' },
    { on: { transition: 'CH-02' }, nth: 1, replace: 'CH-03' },
    { on: { command: 'updateChannelConfig' }, nth: 1, replace: 'unreachable', delayMs: 1_200 },
    {
      on: { command: 'updateChannelConfig' }, nth: 1, replace: 'refuse',
      refusal: { status: 422, code: 'config.invalid', title: 'This layout could not be applied.' },
    },
    { on: { command: 'createStreamTarget' }, nth: 1, replace: 'unreachable', delayMs: 1_200 },
    {
      on: { command: 'createStreamTarget' }, nth: 1, replace: 'refuse',
      refusal: { status: 422, code: 'validation.invalid', title: 'The streaming destination rejected these settings.' },
    },
  ],
};
