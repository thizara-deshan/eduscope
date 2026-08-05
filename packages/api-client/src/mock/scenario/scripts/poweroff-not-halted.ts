import type { ScenarioScript } from '../types.js';

/**
 * B-50 from the other side.
 *
 * The legacy endpoint answered "Successfull" whether or not the shutdown ran,
 * and the legacy UI treated a failed request as success. S-12's `accepted, not
 * halted` (§5 state 8) is the inversion: the device accepted the command,
 * `resolveBySec` elapsed, the socket is still alive — so the panel says so and
 * offers ONE explicit retry rather than stranding a healthy device on a
 * terminal screen (S12-D-5).
 *
 * Three taps, three states, one run:
 *   1. `refused (other)` — an unrelated Problem; the destructive button is
 *      replaced by Close (§5 state 9)
 *   2. `accepted, not halted` — the 202 is accepted and `replace: 'stall'`
 *      suppresses the transport close that would otherwise resolve it (CG-16,
 *      S12-D-2), so the not-halted line and **Try again** appear (§5 state 8)
 *   3. Try again — no rule matches, the socket closes, `accepted` (§5 state 7)
 *
 * Both rules carry `nth: 1` deliberately. `match()` consumes an occurrence the
 * moment a rule's PREDICATE passes, and rule 1's predicate is only evaluated in
 * `onCommand` (it is a `refuse`) while rule 2's is only evaluated in `onStall` —
 * so their counters advance independently and `nth: 2` on rule 2 would never
 * fire.
 */
export const poweroffNotHalted: ScenarioScript = {
  name: 'poweroff-not-halted',
  description:
    'The shutdown is first refused for an unrelated reason, then accepted and never ' +
    'honoured. The panel must offer Try again rather than declaring failure or leaving a ' +
    'healthy device on a dead-end screen.',
  forced: [
    {
      on: { command: 'powerOffDevice' },
      nth: 1,
      replace: 'refuse',
      refusal: {
        status: 503,
        code: 'conflict',
        title: 'The device could not be reached to shut it down.',
        detail: 'Try again in a moment.',
      },
    },
    { on: { command: 'powerOffDevice' }, nth: 1, replace: 'stall' },
  ],
};
