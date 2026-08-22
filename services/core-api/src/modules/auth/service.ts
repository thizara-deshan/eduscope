import type { TokenPair, User as SafeUser } from '@eduscope/shared';
import { eq } from 'drizzle-orm';
import type { Clock } from '../../lib/clock.js';
import type { IdGenerator } from '../../lib/ids.js';
import { ProblemError } from '../../contracts/problem.js';
import type { DrizzleDb } from '../../db/client.js';
import { authSessions, users } from '../../db/schema.js';
import { SerialWriter } from '../../db/writer.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { generateRefreshToken, hashRefreshToken, type AccessTokenClaims, type AccessTokenSigner } from './tokens.js';

export interface AuthContext {
  userId: string;
  authSessionId: string;
  role: 'lecturer' | 'admin';
  mustResetPassword: boolean;
}

export interface LoginInput {
  username: string;
  password: string;
  client: 'panel' | 'admin' | 'api';
}

export interface LoginResult {
  user: SafeUser;
  tokens: TokenPair;
  mustResetPassword: boolean;
}

export interface AuthServiceDeps {
  db: DrizzleDb;
  clock: Clock;
  ids: IdGenerator;
  jwt: AccessTokenSigner;
  accessTokenTtlSec: number;
  refreshTokenTtlSec: number;
  writer?: SerialWriter;
}

function toSafeUser(row: typeof users.$inferSelect): SafeUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    source: row.source,
    mustResetPassword: row.mustResetPassword,
    disabled: row.disabled,
    lastLoginAt: row.lastLoginAt ?? null,
    createdAt: row.createdAt,
  };
}

const INVALID_CREDENTIALS = () => new ProblemError(401, 'auth.invalid-credentials', 'Invalid username or password');

/**
 * Persistent auth/session lifecycle (LP-1, LP-2, PF-17). The only writer of
 * `users.password_hash`/`mustResetPassword` and `auth_sessions` rows.
 */
export class AuthService {
  readonly #deps: AuthServiceDeps;
  readonly #writer: SerialWriter;

  constructor(deps: AuthServiceDeps) {
    this.#deps = deps;
    this.#writer = deps.writer ?? new SerialWriter();
  }

  async login(input: LoginInput): Promise<LoginResult> {
    const { db, clock, ids } = this.#deps;
    const now = clock.now();
    const nowIso = now.toISOString();

    const userRow = db.select().from(users).where(eq(users.username, input.username)).get();
    if (!userRow || !userRow.passwordHash) {
      throw INVALID_CREDENTIALS();
    }
    if (userRow.disabled) {
      throw new ProblemError(401, 'auth.account-disabled', 'This account has been disabled');
    }
    if (!(await verifyPassword(userRow.passwordHash, input.password))) {
      throw INVALID_CREDENTIALS();
    }

    const authSessionId = ids.next(now);
    const refreshToken = generateRefreshToken();
    const refreshTokenHash = hashRefreshToken(refreshToken);
    const expiresAt = new Date(now.getTime() + this.#deps.refreshTokenTtlSec * 1000).toISOString();

    await this.#writer.run('auth.login', () => {
      db.transaction((tx) => {
        tx.insert(authSessions)
          .values({
            id: authSessionId,
            userId: userRow.id,
            client: input.client,
            refreshTokenHash,
            issuedAt: nowIso,
            expiresAt,
            lastActivityAt: nowIso,
          })
          .run();
        tx.update(users).set({ lastLoginAt: nowIso }).where(eq(users.id, userRow.id)).run();
      });
    });

    const accessToken = this.#signAccessToken({ sub: userRow.id, role: userRow.role, sid: authSessionId });

    return {
      user: toSafeUser({ ...userRow, lastLoginAt: nowIso }),
      tokens: { accessToken, refreshToken, expiresInSec: this.#deps.accessTokenTtlSec },
      mustResetPassword: userRow.mustResetPassword,
    };
  }

  async refresh(refreshToken: string): Promise<{ tokens: TokenPair }> {
    const { db, clock } = this.#deps;
    const now = clock.now();
    const nowIso = now.toISOString();
    const presentedHash = hashRefreshToken(refreshToken);

    const sessionRow = db.select().from(authSessions).where(eq(authSessions.refreshTokenHash, presentedHash)).get();
    if (!sessionRow) {
      throw INVALID_CREDENTIALS();
    }
    if (sessionRow.revokedAt) {
      throw new ProblemError(401, 'auth.session-revoked', 'Session has been revoked');
    }
    if (sessionRow.expiresAt <= nowIso) {
      await this.#writer.run('auth.refresh.expire', () => {
        db.update(authSessions)
          .set({ revokedAt: nowIso, revokedReason: 'expiry' })
          .where(eq(authSessions.id, sessionRow.id))
          .run();
      });
      throw new ProblemError(401, 'auth.session-revoked', 'Session has been revoked');
    }

    const userRow = db.select().from(users).where(eq(users.id, sessionRow.userId)).get();
    if (!userRow || userRow.disabled) {
      throw new ProblemError(401, 'auth.account-disabled', 'This account has been disabled');
    }

    const nextRefreshToken = generateRefreshToken();
    const nextRefreshTokenHash = hashRefreshToken(nextRefreshToken);
    const nextExpiresAt = new Date(now.getTime() + this.#deps.refreshTokenTtlSec * 1000).toISOString();

    await this.#writer.run('auth.refresh', () => {
      db.update(authSessions)
        .set({ refreshTokenHash: nextRefreshTokenHash, expiresAt: nextExpiresAt, lastActivityAt: nowIso })
        .where(eq(authSessions.id, sessionRow.id))
        .run();
    });

    const accessToken = this.#signAccessToken({ sub: userRow.id, role: userRow.role, sid: sessionRow.id });

    return { tokens: { accessToken, refreshToken: nextRefreshToken, expiresInSec: this.#deps.accessTokenTtlSec } };
  }

  async logout(authSessionId: string): Promise<void> {
    const { db, clock } = this.#deps;
    const nowIso = clock.now().toISOString();

    await this.#writer.run('auth.logout', () => {
      const row = db.select().from(authSessions).where(eq(authSessions.id, authSessionId)).get();
      if (!row || row.revokedAt) return;
      db.update(authSessions)
        .set({ revokedAt: nowIso, revokedReason: 'logout' })
        .where(eq(authSessions.id, authSessionId))
        .run();
    });
  }

  async getMe(userId: string): Promise<SafeUser> {
    const userRow = this.#deps.db.select().from(users).where(eq(users.id, userId)).get();
    if (!userRow) {
      throw new ProblemError(401, 'auth.session-revoked', 'Session has been revoked');
    }
    return toSafeUser(userRow);
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const { db } = this.#deps;
    const userRow = db.select().from(users).where(eq(users.id, userId)).get();
    if (!userRow || !userRow.passwordHash || !(await verifyPassword(userRow.passwordHash, currentPassword))) {
      throw INVALID_CREDENTIALS();
    }

    const newHash = await hashPassword(newPassword);
    await this.#writer.run('auth.change-password', () => {
      db.update(users).set({ passwordHash: newHash, mustResetPassword: false }).where(eq(users.id, userId)).run();
    });
  }

  /** The single verification path `guard.ts` calls; re-checks DB state on every request (INV-AS-2). */
  async authenticate(accessToken: string): Promise<AuthContext> {
    let claims: AccessTokenClaims;
    try {
      claims = this.#deps.jwt.verify(accessToken);
    } catch {
      throw INVALID_CREDENTIALS();
    }

    const { db } = this.#deps;
    const sessionRow = db.select().from(authSessions).where(eq(authSessions.id, claims.sid)).get();
    if (!sessionRow || sessionRow.revokedAt || sessionRow.expiresAt <= this.#deps.clock.now().toISOString()) {
      throw new ProblemError(401, 'auth.session-revoked', 'Session has been revoked');
    }

    const userRow = db.select().from(users).where(eq(users.id, sessionRow.userId)).get();
    if (!userRow || userRow.disabled) {
      throw new ProblemError(401, 'auth.account-disabled', 'This account has been disabled');
    }

    return {
      userId: userRow.id,
      authSessionId: sessionRow.id,
      role: userRow.role,
      mustResetPassword: userRow.mustResetPassword,
    };
  }

  #signAccessToken(claims: AccessTokenClaims): string {
    return this.#deps.jwt.sign(claims);
  }
}
