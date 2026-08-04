import type { ScenarioScript } from '../types.js';

/**
 * The two auth states that contract v0.2 made expressible but that no ordinary
 * mock interaction can produce (S-01 §10, S-02 §10 — "no scenario script
 * exercises an auth failure").
 *
 * The other v0.2 states need no script: `disabled account` is reachable by
 * logging in as the seeded `r.fonseka` (CG-10), and Sign out on the forced
 * reset screen is reachable because `/auth/logout` is exempt (CG-13).
 *
 * NOT covered: S-01's `backend unreachable`. That is a transport failure, not a
 * named `Problem`, and the engine has no transport-level primitive — inventing
 * one is a scenario-engine change, not a contract amendment. It stays Wave-1
 * work (see docs/design/contract-amendments.md, 2026-08-04).
 */
export const authFailures: ScenarioScript = {
  name: 'auth-failures',
  description:
    'A refresh that comes back revoked with reason=takeover (R-21), so S-01 can word ' +
    'session-expired as a takeover rather than an idle expiry; and a first ' +
    'change-password that the server refuses on policy, so S-02 can render ' +
    'rejected (policy) even though a correct client checklist would never submit it.',
  forced: [
    {
      // CG-11: the reason vocabulary, carried end to end. `takeover` is the one
      // value a client cannot infer for itself, and S-06 (W-2) reads the same word.
      on: { command: 'refreshToken' },
      replace: 'refuse',
      refusal: {
        status: 401,
        code: 'auth.session-revoked',
        title: 'Session revoked',
        meta: { reason: 'takeover' },
      },
    },
    {
      // CG-12: proves the screen survives a server that disagrees with the
      // client mirror. `nth: 1` only — the second attempt succeeds, so the
      // demo recovers instead of dead-ending.
      on: { command: 'changePassword' },
      nth: 1,
      replace: 'refuse',
      refusal: {
        status: 422,
        code: 'validation.invalid',
        title: 'New password does not meet the password policy',
      },
    },
  ],
};
