import type { ScenarioScript } from '../types.js';

/**
 * Class A (state-machines §0.4): storage is critical, so R-02 refuses the start
 * and NO session row is created — never a phantom `error` row in the library
 * (SM-Q-1). The warning text must be generated from the real RetentionPolicy
 * carried on storage.status, not hardcoded (INV-RP-1, B-53).
 */
export const diskFull: ScenarioScript = {
  name: 'disk-full',
  description:
    'The recordings volume is over its critical threshold. Start is refused with the ' +
    'real policy text, and an in-progress lecture is stopped gracefully by R-19.',
  seed: { storagePressure: 'critical' },
  forced: [
    {
      on: { command: 'startRecording' },
      replace: 'refuse',
      refusal: {
        status: 409,
        code: 'storage.critical',
        title: 'Not enough free space to start a recording',
        detail: 'Free space is below the critical threshold in the retention policy.',
      },
    },
    { on: { transition: 'R-01' }, replace: 'R-02' },
  ],
};
