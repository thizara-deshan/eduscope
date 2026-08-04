import type { ScenarioScript } from '../types.js';

/**
 * The auth states that contract v0.2 made expressible but that no ordinary
 * mock interaction can produce (S-01 §10, S-02 §10 — "no scenario script
 * exercises an auth failure"), plus the two Wave-1 additions below (W1-D-1,
 * W1-D-6): S-01's `backend unreachable` transport fault, and a `getProvisioning`
 * refusal so `session expired` (takeover) has a live producer reachable from a
 * normal sign-in rather than only from a forced `refreshToken` refusal.
 *
 * The other v0.2 states need no script: `disabled account` is reachable by
 * logging in as the seeded `r.fonseka` (CG-10), and Sign out on the forced
 * reset screen is reachable because `/auth/logout` is exempt (CG-13).
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
    {
      // S-01 `backend unreachable` (S-01 §5): a transport failure, not a
      // Problem. The delay does two jobs — it holds `submitting` on screen long
      // enough to review the pending affordance, and it makes the recovery
      // (auto-retry succeeds on attempt 2) the demo rather than a dead end.
      on: { command: 'login' },
      nth: 1,
      replace: 'unreachable',
      delayMs: 1_200,
    },
    {
      // S-01 `session expired`, takeover wording (CG-11 / R-21). getProvisioning
      // is S-03's first authenticated read, so refusing it once is the shortest
      // honest path from "an administrator took the recorder" to the login
      // screen wording it. `nth: 1` so the next sign-in is not thrown out again.
      on: { command: 'getProvisioning' },
      nth: 1,
      replace: 'refuse',
      refusal: {
        status: 401,
        code: 'auth.session-revoked',
        title: 'Session revoked',
        meta: { reason: 'takeover' },
      },
    },
  ],
};
