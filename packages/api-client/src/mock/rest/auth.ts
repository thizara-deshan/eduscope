import {
  zChangePasswordRequest, zLoginResponse, zRefreshResponse, zUser,
  type ChangePasswordRequest, type LoginRequest, type LoginResponse,
  type RefreshResponse, type User,
} from '@eduscope/shared';
import { ProblemError } from '../../errors.js';
import { validated } from '../seed/index.js';
import type { RestContext } from './index.js';

/**
 * "Current session" mechanism (the brief leaves this to our judgment — noted
 * in task-10-report.md): a single mutable slot on `world.data`, the same
 * bag every machine already uses for entity state. Unset means nobody has
 * called `login` yet in this mock instance, which defaults to the seeded
 * lecturer (`a.perera`) rather than throwing — every other read in this
 * package assumes a logged-in panel.
 */
export function currentUser({ world, seed }: RestContext): User {
  const id = world.data['auth.currentUserId'] as string | undefined;
  const found = id ? seed.users.find((u) => u.id === id) : undefined;
  return found ?? seed.users.find((u) => u.username === 'a.perera')!;
}

export function isAdmin(ctx: RestContext): boolean {
  return currentUser(ctx).role === 'admin';
}

/** INV-U-4: the server gate is the security boundary, the UI gate is convenience. */
export function requireAdmin(ctx: RestContext): void {
  if (!isAdmin(ctx)) {
    throw new ProblemError({ status: 403, code: 'not-authorized', title: 'Admins only' });
  }
}

let tokenCounter = 0;
function issueTokenPair() {
  tokenCounter += 1;
  return {
    accessToken: `mock-access-${tokenCounter}`,
    refreshToken: `mock-refresh-${tokenCounter}`,
    expiresInSec: 900,
  };
}

export function createAuthOperations(ctx: RestContext) {
  const { world, engine, seed, credentials } = ctx;

  return {
    login: async (body: LoginRequest): Promise<LoginResponse> => {
      const refusal = engine.onCommand('login');
      if (refusal) throw new ProblemError(refusal);

      const user = seed.users.find((u) => u.username === body.username);
      if (!user || credentials[body.username] !== body.password) {
        throw new ProblemError({
          status: 401,
          code: 'auth.invalid-credentials',
          title: 'Invalid username or password',
        });
      }
      // Contract v0.2 (CG-10 / S01-D-3). Checked AFTER the credential pair, as
      // openapi.yaml's `login` description words it: you must already know the
      // password to learn that the account is disabled, which is the narrow
      // enumeration S01-D-3 accepted. No session is created.
      if (user.disabled) {
        throw new ProblemError({
          status: 401,
          code: 'auth.account-disabled',
          title: 'Account is not active',
        });
      }
      world.data['auth.currentUserId'] = user.id;
      return validated(zLoginResponse, {
        user,
        tokens: issueTokenPair(),
        mustResetPassword: user.mustResetPassword,
      });
    },

    refreshToken: async (body: { refreshToken: string }): Promise<RefreshResponse> => {
      const refusal = engine.onCommand('refreshToken');
      if (refusal) throw new ProblemError(refusal);
      if (!body.refreshToken) {
        // Contract v0.2 (CG-11 / S01-D-5): `auth.session-revoked` always names
        // its reason, so S-01 can word `session expired` instead of guessing.
        // `expired` is the ordinary case; `takeover` (R-21), `admin` and
        // `logout` arrive through the scenario engine — see scripts/auth-failures.ts.
        throw new ProblemError({
          status: 401,
          code: 'auth.session-revoked',
          title: 'Session revoked',
          meta: { reason: 'expired' },
        });
      }
      return validated(zRefreshResponse, { tokens: issueTokenPair() });
    },

    /**
     * Never gated on `mustResetPassword`: contract v0.2 exempts `/auth/logout`
     * from the reset lock alongside `/auth/change-password` and `/auth/me`
     * (CG-13 / S02-D-3), so S-02's Sign out genuinely revokes rather than
     * leaving a live session on an abandoned kiosk.
     */
    logout: async (): Promise<void> => {
      const refusal = engine.onCommand('logout');
      if (refusal) throw new ProblemError(refusal);
      delete world.data['auth.currentUserId'];
      return undefined;
    },

    getMe: async (): Promise<User> => validated(zUser, currentUser(ctx)),

    changePassword: async (body: ChangePasswordRequest): Promise<void> => {
      const refusal = engine.onCommand('changePassword');
      if (refusal) throw new ProblemError(refusal);

      // Contract v0.2 (CG-12 / S02-D-1): ≥8 + digit + uppercase + lowercase,
      // legacy parity with B-42. Validated with the schema GENERATED from
      // openapi.yaml rather than a hand-written regex, so this validator cannot
      // drift from the contract that S-02's `password-policy.ts` mirrors —
      // drift is the one defect that screen cannot tolerate. Body validation
      // precedes the credential check, as a 422 is about the request, not the user.
      if (!zChangePasswordRequest.safeParse(body).success) {
        throw new ProblemError({
          status: 422,
          code: 'validation.invalid',
          title: 'New password does not meet the password policy',
        });
      }

      const user = currentUser(ctx);
      if (credentials[user.username] !== body.currentPassword) {
        throw new ProblemError({
          status: 401,
          code: 'auth.invalid-credentials',
          title: 'Current password is incorrect',
        });
      }
      credentials[user.username] = body.newPassword;
      const row = seed.users.find((u) => u.id === user.id)!;
      row.mustResetPassword = false;
      return undefined;
    },
  };
}
