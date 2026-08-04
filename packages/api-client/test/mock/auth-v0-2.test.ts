import { describe, expect, it } from 'vitest';
import { zProblem } from '@eduscope/shared';
import { createMockClient } from '../../src/mock/create-mock-client.js';
import { ProblemError } from '../../src/errors.js';

/**
 * The four contract v0.2 amendments (CG-10…CG-13), proved at the mock boundary.
 * See docs/design/contract-amendments.md, 2026-08-04.
 *
 * Each refusal is parsed with `zProblem` as well as inspected: a mock that
 * emits a code or a `meta` shape the contract does not describe is exactly the
 * drift the contract-honesty gate exists to catch.
 */
async function refusalOf(call: () => Promise<unknown>) {
  try {
    await call();
  } catch (e) {
    expect(e).toBeInstanceOf(ProblemError);
    const { problem } = e as ProblemError;
    expect(() => zProblem.parse(problem)).not.toThrow();
    return problem;
  }
  throw new Error('expected a ProblemError, got a resolved promise');
}

describe('CG-10 — auth.account-disabled', () => {
  const client = createMockClient('happy');

  it('refuses a disabled account with its own code, not a credential error', async () => {
    const problem = await refusalOf(() =>
      client.login({ username: 'r.fonseka', password: 'Correct-horse-9', client: 'panel' }),
    );
    expect(problem).toMatchObject({ status: 401, code: 'auth.account-disabled' });
  });

  it('still reports a wrong password on a disabled account as a credential error', async () => {
    // S01-D-3 accepted enumeration only for someone who already has the
    // password; a wrong password must not reveal that the account is disabled.
    const problem = await refusalOf(() =>
      client.login({ username: 'r.fonseka', password: 'wrong', client: 'panel' }),
    );
    expect(problem).toMatchObject({ code: 'auth.invalid-credentials' });
  });
});

describe('CG-11 — auth.session-revoked always names a reason', () => {
  it('an ordinary revoked refresh reports reason=expired', async () => {
    const client = createMockClient('happy');
    const problem = await refusalOf(() => client.refreshToken({ refreshToken: '' }));
    expect(problem).toMatchObject({ code: 'auth.session-revoked', meta: { reason: 'expired' } });
  });

  it('the auth-failures scenario reaches reason=takeover (R-21), which nothing else can', async () => {
    const client = createMockClient('auth-failures');
    const problem = await refusalOf(() => client.refreshToken({ refreshToken: 'mock-refresh-1' }));
    expect(problem).toMatchObject({ code: 'auth.session-revoked', meta: { reason: 'takeover' } });
  });

  it('zProblem keeps BOTH the typed reason and unrelated open meta keys', async () => {
    const parsed = zProblem.parse({
      status: 401,
      code: 'auth.session-revoked',
      title: 'Session revoked',
      meta: { reason: 'admin', revokedBy: 'D. Admin' },
    });
    expect(parsed.meta).toEqual({ reason: 'admin', revokedBy: 'D. Admin' });
  });

  it('rejects a reason outside the closed vocabulary', () => {
    expect(() =>
      zProblem.parse({
        status: 401,
        code: 'auth.session-revoked',
        title: 'Session revoked',
        meta: { reason: 'because' },
      }),
    ).toThrow();
  });
});

describe('CG-12 — the password policy is legacy parity (B-42)', () => {
  const client = createMockClient('happy');

  async function login() {
    await client.login({ username: 'n.silva', password: 'temp-pass-1', client: 'panel' });
  }

  it.each([
    ['short1A', 'shorter than 8'],
    ['alllowercase1', 'no uppercase'],
    ['ALLUPPERCASE1', 'no lowercase'],
    ['NoDigitsHere', 'no digit'],
  ])('refuses %s (%s) with 422 validation.invalid', async (newPassword) => {
    await login();
    const problem = await refusalOf(() =>
      client.changePassword({ currentPassword: 'temp-pass-1', newPassword }),
    );
    expect(problem).toMatchObject({ status: 422, code: 'validation.invalid' });
  });

  it('accepts a compliant password and clears mustResetPassword', async () => {
    const fresh = createMockClient('happy');
    await fresh.login({ username: 'n.silva', password: 'temp-pass-1', client: 'panel' });
    await fresh.changePassword({ currentPassword: 'temp-pass-1', newPassword: 'Lecture-hall-7' });
    await expect(fresh.getMe()).resolves.toMatchObject({ mustResetPassword: false });
  });

  it('a password change does not leak into another mock client', async () => {
    // The credential store is per-client (RestContext.credentials), so the
    // change above cannot reach this one — no test here restores global state,
    // and none should have to.
    const other = createMockClient('happy');
    await expect(
      other.login({ username: 'n.silva', password: 'temp-pass-1', client: 'panel' }),
    ).resolves.toMatchObject({ mustResetPassword: true });
  });

  it('a password change does not survive switchScenario on the same client', async () => {
    const switching = createMockClient('happy');
    await switching.login({ username: 'n.silva', password: 'temp-pass-1', client: 'panel' });
    await switching.changePassword({
      currentPassword: 'temp-pass-1',
      newPassword: 'Lecture-hall-7',
    });
    switching.switchScenario('auth-failures');
    // switchScenario rebuilds the world and the seed; credentials share that
    // lifetime, so the seeded temp password is live again.
    await expect(
      switching.login({ username: 'n.silva', password: 'temp-pass-1', client: 'panel' }),
    ).resolves.toMatchObject({ mustResetPassword: true });
  });

  it('checks the body before the credential — a bad new password is 422, not 401', async () => {
    await login();
    const problem = await refusalOf(() =>
      client.changePassword({ currentPassword: 'also-wrong', newPassword: 'weak' }),
    );
    expect(problem).toMatchObject({ status: 422 });
  });

  it('the auth-failures scenario reaches rejected(policy) despite a compliant password', async () => {
    // S-02 §5: unreachable in practice if password-policy.ts mirrors the server
    // correctly, which is precisely why it needs a scenario to be demonstrable.
    const scripted = createMockClient('auth-failures');
    await scripted.login({ username: 'n.silva', password: 'temp-pass-1', client: 'panel' });
    const problem = await refusalOf(() =>
      scripted.changePassword({ currentPassword: 'temp-pass-1', newPassword: 'Lecture-hall-7' }),
    );
    expect(problem).toMatchObject({ status: 422, code: 'validation.invalid' });
    // nth: 1 — the retry succeeds, so the demo recovers rather than dead-ending.
    await expect(
      scripted.changePassword({ currentPassword: 'temp-pass-1', newPassword: 'Lecture-hall-7' }),
    ).resolves.toBeUndefined();
  });
});

describe('CG-13 — /auth/logout is exempt from the mustResetPassword lock', () => {
  it('a user who still must reset can end their session (S-02 Sign out)', async () => {
    const client = createMockClient('happy');
    const login = await client.login({
      username: 'n.silva',
      password: 'temp-pass-1',
      client: 'panel',
    });
    expect(login.mustResetPassword).toBe(true);
    await expect(client.logout()).resolves.toBeUndefined();
  });
});
