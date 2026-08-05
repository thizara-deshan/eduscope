import type { ScenarioScript } from '../types.js';

/**
 * BOTH refusal classes on one script (state-machines §0.4).
 *
 * Attempt 1 is **Class A**: R-04's named-reason rejection — no session row is
 * created, so the library never grows a phantom `error` row (SM-Q-1), and S-04
 * must name which piece is missing rather than say "could not start"
 * (INV-SB-3, B-01).
 *
 * Attempt 2 is **Class B**: the session IS created and then fails to `error` —
 * a start that fails must never read as `recording` (B-12, LP-4, J-1 failure).
 *
 * `nth: 1` on the first rule is what makes the demo recover rather than
 * dead-end — the shape `auth-failures` already uses for `changePassword`.
 */
export const startFails: ScenarioScript = {
  name: 'start-fails',
  description:
    'The first Start is refused outright with a named configuration reason (Class A, no ' +
    'session row). The second creates a session whose consumer never confirms, so R-05 ' +
    'is replaced by R-06: starting -> error, and the red frame never appears.',
  forced: [
    {
      on: { command: 'startRecording' },
      nth: 1,
      replace: 'refuse',
      refusal: {
        status: 409,
        code: 'config.invalid',
        title: 'The Students Camera is not connected to this device.',
        detail:
          'The current recording layout needs it. An administrator can change the layout or reconnect the camera.',
      },
    },
    { on: { transition: 'R-05' }, replace: 'R-06' },
  ],
};
