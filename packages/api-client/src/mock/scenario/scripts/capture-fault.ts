import type { ScenarioScript } from '../types.js';

/**
 * Machine 5c (state-machines §6.4): the presentation capture card drops out and
 * the supervised watchdog fails to recover it. Drives present → absent →
 * recovering → failed so S-36 can render each capture state and the "camera-only
 * recording still works" reassurance (A-08, S-36-design §2.4).
 */
export const captureFault: ScenarioScript = {
  name: 'capture-fault',
  description:
    'The presentation capture card is lost and the watchdog cannot recover it: '
    + 'present → absent → recovering → failed. Camera-only recording keeps working.',
  // HL-21 (absent → recovering) auto-fires HL-22 (recover) after 1.5 s; intercept
  // that to HL-23 so recovering ends in failed, not present.
  forced: [{ on: { transition: 'HL-22' }, replace: 'HL-23' }],
  timeline: [
    { transition: 'HL-20', afterMs: 2_000 }, // present → absent
    { transition: 'HL-21', afterMs: 4_000 }, // absent → recovering (→ HL-23 failed)
  ],
};
