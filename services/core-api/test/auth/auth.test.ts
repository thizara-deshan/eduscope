import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { openDatabase, type CoreDatabase } from '../../src/db/client.js';
import { migrate } from '../../src/db/migrate.js';
import { seed } from '../../src/db/seeds.js';
import { authSessions, users } from '../../src/db/schema.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { ProblemError } from '../../src/contracts/problem.js';
import { requireAuth } from '../../src/modules/auth/guard.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { AuthService } from '../../src/modules/auth/service.js';
import { hashRefreshToken, type AccessTokenClaims, type AccessTokenSigner } from '../../src/modules/auth/tokens.js';
import { FakeClock } from '../fakes/clock.js';

/** Deterministic, DB-independent stand-in for `@fastify/jwt` (app.ts wires the real signer). */
class FakeSigner implements AccessTokenSigner {
  readonly issued: AccessTokenClaims[] = [];

  sign(claims: AccessTokenClaims): string {
    this.issued.push(claims);
    return Buffer.from(JSON.stringify(claims)).toString('base64url');
  }

  verify(token: string): AccessTokenClaims {
    try {
      return JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as AccessTokenClaims;
    } catch {
      throw new Error('invalid token');
    }
  }
}

interface TestContext {
  dir: string;
  dbPath: string;
  core: CoreDatabase;
  clock: FakeClock;
  ids: UlidGenerator;
  signer: FakeSigner;
  authService: AuthService;
}

const NOW = new Date('2026-01-01T00:00:00.000Z');

function createContext(overrides: { accessTokenTtlSec?: number; refreshTokenTtlSec?: number } = {}): TestContext {
  const dir = mkdtempSync(join(tmpdir(), 'core-api-auth-'));
  const dbPath = join(dir, 'core.db');
  const core = openDatabase(dbPath);
  migrate(core);
  const clock = new FakeClock(NOW);
  const ids = new UlidGenerator();
  seed(core, clock.now(), ids);
  const signer = new FakeSigner();
  const authService = new AuthService({
    db: core.db,
    clock,
    ids,
    jwt: signer,
    accessTokenTtlSec: overrides.accessTokenTtlSec ?? 600,
    refreshTokenTtlSec: overrides.refreshTokenTtlSec ?? 2_592_000,
  });
  return { dir, dbPath, core, clock, ids, signer, authService };
}

function destroyContext(ctx: TestContext): void {
  ctx.core.close();
  rmSync(ctx.dir, { recursive: true, force: true });
}

async function insertUser(
  core: CoreDatabase,
  input: {
    id: string;
    username: string;
    password: string | null;
    role?: 'lecturer' | 'admin';
    disabled?: boolean;
    mustResetPassword?: boolean;
  },
): Promise<void> {
  core.db
    .insert(users)
    .values({
      id: input.id,
      username: input.username,
      displayName: input.username,
      role: input.role ?? 'lecturer',
      source: 'local',
      passwordHash: input.password === null ? null : await hashPassword(input.password),
      mustResetPassword: input.mustResetPassword ?? false,
      disabled: input.disabled ?? false,
      createdAt: NOW.toISOString(),
    })
    .run();
}

function fakeRequest(accessToken?: string): FastifyRequest {
  return {
    headers: accessToken === undefined ? {} : { authorization: `Bearer ${accessToken}` },
  } as unknown as FastifyRequest;
}

const noopReply = {} as FastifyReply;

describe('AuthService', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = createContext();
    await insertUser(ctx.core, { id: 'user-lecturer', username: 'lecturer1', password: 'Password1' });
    await insertUser(ctx.core, { id: 'user-disabled', username: 'disabled1', password: 'Password1', disabled: true });
    await insertUser(ctx.core, { id: 'user-no-hash', username: 'institute1', password: null });
  });

  afterEach(() => {
    destroyContext(ctx);
  });

  describe('login', () => {
    it('accepts correct local credentials and issues a 10-minute access token carrying only {sub,role,sid}', async () => {
      const result = await ctx.authService.login({ username: 'lecturer1', password: 'Password1', client: 'panel' });

      expect(result.user).toMatchObject({ id: 'user-lecturer', username: 'lecturer1', role: 'lecturer' });
      expect(result.user).not.toHaveProperty('passwordHash');
      expect(result.mustResetPassword).toBe(false);
      expect(result.tokens.expiresInSec).toBe(600);

      expect(ctx.signer.issued).toHaveLength(1);
      const claims = ctx.signer.issued[0]!;
      expect(Object.keys(claims).sort()).toEqual(['role', 'sid', 'sub']);
      expect(claims.sub).toBe('user-lecturer');
      expect(claims.role).toBe('lecturer');
    });

    it('rejects a wrong password with auth.invalid-credentials', async () => {
      await expect(
        ctx.authService.login({ username: 'lecturer1', password: 'wrong', client: 'panel' }),
      ).rejects.toMatchObject({ status: 401, code: 'auth.invalid-credentials' });
    });

    it('rejects an unknown username with auth.invalid-credentials', async () => {
      await expect(
        ctx.authService.login({ username: 'nobody', password: 'Password1', client: 'panel' }),
      ).rejects.toMatchObject({ status: 401, code: 'auth.invalid-credentials' });
    });

    it('rejects a user with no local password hash with auth.invalid-credentials', async () => {
      await expect(
        ctx.authService.login({ username: 'institute1', password: 'Password1', client: 'panel' }),
      ).rejects.toMatchObject({ status: 401, code: 'auth.invalid-credentials' });
    });

    it('rejects a correct password on a disabled account with auth.account-disabled', async () => {
      await expect(
        ctx.authService.login({ username: 'disabled1', password: 'Password1', client: 'panel' }),
      ).rejects.toMatchObject({ status: 401, code: 'auth.account-disabled' });
    });

    it('stores only a SHA-256 hash of the refresh token, never the raw value', async () => {
      const result = await ctx.authService.login({ username: 'lecturer1', password: 'Password1', client: 'panel' });

      const row = ctx.core.db
        .select()
        .from(authSessions)
        .where(eq(authSessions.id, sidFromAccessToken(result.tokens.accessToken)))
        .get()!;
      expect(row.refreshTokenHash).toBe(hashRefreshToken(result.tokens.refreshToken));
      expect(row.refreshTokenHash).not.toBe(result.tokens.refreshToken);
    });
  });

  describe('refresh', () => {
    it('rotates the token pair and invalidates the presented refresh token (one-time use)', async () => {
      const login = await ctx.authService.login({ username: 'lecturer1', password: 'Password1', client: 'panel' });

      const rotated = await ctx.authService.refresh(login.tokens.refreshToken);
      expect(rotated.tokens.refreshToken).not.toBe(login.tokens.refreshToken);

      await expect(ctx.authService.refresh(login.tokens.refreshToken)).rejects.toMatchObject({
        status: 401,
        code: 'auth.invalid-credentials',
      });

      // the rotated token still works exactly once
      await expect(ctx.authService.refresh(rotated.tokens.refreshToken)).resolves.toBeDefined();
    });

    it('rejects an unrecognized refresh token', async () => {
      await expect(ctx.authService.refresh('not-a-real-token')).rejects.toMatchObject({
        status: 401,
        code: 'auth.invalid-credentials',
      });
    });
  });

  describe('logout', () => {
    it('revokes the session so its refresh token can no longer be used', async () => {
      const login = await ctx.authService.login({ username: 'lecturer1', password: 'Password1', client: 'panel' });
      const claims = ctx.signer.issued[0]!;

      await ctx.authService.logout(claims.sid);

      await expect(ctx.authService.refresh(login.tokens.refreshToken)).rejects.toMatchObject({
        status: 401,
        code: 'auth.session-revoked',
      });
    });

    it('is idempotent when called twice', async () => {
      await ctx.authService.login({ username: 'lecturer1', password: 'Password1', client: 'panel' });
      const claims = ctx.signer.issued[0]!;

      await expect(ctx.authService.logout(claims.sid)).resolves.toBeUndefined();
      await expect(ctx.authService.logout(claims.sid)).resolves.toBeUndefined();
    });
  });

  describe('getMe', () => {
    it('never returns a password hash', async () => {
      const user = await ctx.authService.getMe('user-lecturer');
      expect(user).not.toHaveProperty('passwordHash');
      expect(user.username).toBe('lecturer1');
    });
  });

  describe('changePassword', () => {
    it('rejects the wrong current password', async () => {
      await expect(
        ctx.authService.changePassword('user-lecturer', 'wrong', 'NewPassw0rd'),
      ).rejects.toMatchObject({ status: 401, code: 'auth.invalid-credentials' });
    });

    it('clears mustResetPassword and accepts the new password on the next login', async () => {
      await insertUser(ctx.core, {
        id: 'user-reset',
        username: 'reset1',
        password: 'OldPassw0rd',
        mustResetPassword: true,
      });

      await ctx.authService.changePassword('user-reset', 'OldPassw0rd', 'NewPassw0rd');

      const result = await ctx.authService.login({ username: 'reset1', password: 'NewPassw0rd', client: 'panel' });
      expect(result.mustResetPassword).toBe(false);
    });
  });

  describe('forced-reset allowlist (guard.ts)', () => {
    it('blocks a non-exempt operation while mustResetPassword is true', async () => {
      await insertUser(ctx.core, {
        id: 'user-locked',
        username: 'locked1',
        password: 'Password1',
        mustResetPassword: true,
      });
      const login = await ctx.authService.login({ username: 'locked1', password: 'Password1', client: 'panel' });
      const request = fakeRequest(login.tokens.accessToken);

      await expect(requireAuth(ctx.authService, 'startRecording')(request, noopReply)).rejects.toMatchObject({
        status: 403,
        code: 'auth.password-reset-required',
      });
    });

    it.each(['changePassword', 'getMe', 'logout'])('allows %s while mustResetPassword is true', async (operationId) => {
      await insertUser(ctx.core, {
        id: 'user-locked-2',
        username: 'locked2',
        password: 'Password1',
        mustResetPassword: true,
      });
      const login = await ctx.authService.login({ username: 'locked2', password: 'Password1', client: 'panel' });
      const request = fakeRequest(login.tokens.accessToken);

      await expect(requireAuth(ctx.authService, operationId)(request, noopReply)).resolves.toBeUndefined();
      expect(request.authContext).toMatchObject({ userId: 'user-locked-2', mustResetPassword: true });
    });

    it('rejects a missing bearer token', async () => {
      await expect(requireAuth(ctx.authService, 'getMe')(fakeRequest(), noopReply)).rejects.toBeInstanceOf(
        ProblemError,
      );
    });
  });

  describe('disabled/deleted-user revocation after restart', () => {
    it('rejects a previously-issued access token once the user is disabled and the process restarts', async () => {
      const login = await ctx.authService.login({ username: 'lecturer1', password: 'Password1', client: 'panel' });

      // simulate a restart: close and reopen the same on-disk database, build a fresh service
      ctx.core.close();
      const reopened = openDatabase(ctx.dbPath);
      const restartedService = new AuthService({
        db: reopened.db,
        clock: ctx.clock,
        ids: ctx.ids,
        jwt: ctx.signer,
        accessTokenTtlSec: 600,
        refreshTokenTtlSec: 2_592_000,
      });

      reopened.db.update(users).set({ disabled: true }).where(eq(users.username, 'lecturer1')).run();

      await expect(restartedService.authenticate(login.tokens.accessToken)).rejects.toMatchObject({
        status: 401,
        code: 'auth.account-disabled',
      });
      await expect(restartedService.refresh(login.tokens.refreshToken)).rejects.toMatchObject({
        status: 401,
        code: 'auth.account-disabled',
      });

      // afterEach closes whatever `ctx.core` currently points at
      ctx.core = reopened;
    });
  });
});

function sidFromAccessToken(accessToken: string): string {
  return (JSON.parse(Buffer.from(accessToken, 'base64url').toString('utf8')) as AccessTokenClaims).sid;
}
