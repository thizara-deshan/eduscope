import {
  zLoginResponse, zRefreshResponse, zUser,
  type ChangePasswordRequest, type LoginRequest, type LoginResponse,
  type RefreshResponse, type User,
} from '@eduscope/shared';
import { ProblemError } from '../../errors.js';
import { SEED_CREDENTIALS } from '../seed/users.js';
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
  const { world, engine, seed } = ctx;

  return {
    login: async (body: LoginRequest): Promise<LoginResponse> => {
      const refusal = engine.onCommand('login');
      if (refusal) throw new ProblemError(refusal);

      const user = seed.users.find((u) => u.username === body.username);
      if (!user || SEED_CREDENTIALS[body.username] !== body.password) {
        throw new ProblemError({
          status: 401,
          code: 'auth.invalid-credentials',
          title: 'Invalid username or password',
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
        throw new ProblemError({ status: 401, code: 'auth.session-revoked', title: 'Session revoked' });
      }
      return validated(zRefreshResponse, { tokens: issueTokenPair() });
    },

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
      const user = currentUser(ctx);
      if (SEED_CREDENTIALS[user.username] !== body.currentPassword) {
        throw new ProblemError({
          status: 401,
          code: 'auth.invalid-credentials',
          title: 'Current password is incorrect',
        });
      }
      SEED_CREDENTIALS[user.username] = body.newPassword;
      const row = seed.users.find((u) => u.id === user.id)!;
      row.mustResetPassword = false;
      return undefined;
    },
  };
}
