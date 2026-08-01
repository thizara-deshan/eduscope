import { z } from 'zod';
import { Instant, Ulid } from './primitives';
import { AuthClient, UserRole, UserSource } from './enums';

/**
 * Context B — identity & access (domain model §5).
 * LP-1 unified login, LP-2 forced reset, PF-17 short-lived kiosk tokens.
 */

/** Safe read view of User. passwordHash never leaves the data layer (INV-U-1). */
export const User = z.object({
  id: Ulid,
  username: z.string().min(1).max(128),
  displayName: z.string().min(1).max(128),
  role: UserRole,
  source: UserSource,
  mustResetPassword: z.boolean(), // LP-2, successor of flogin (B-42)
  disabled: z.boolean(),
  lastLoginAt: Instant.nullable(),
  createdAt: Instant,
});
export type User = z.infer<typeof User>;

export const LoginRequest = z.object({
  username: z.string().min(1).max(128),
  password: z.string().min(1),
  client: AuthClient,
});
export type LoginRequest = z.infer<typeof LoginRequest>;

/**
 * Token pair. Access token is short-lived (PF-17 — exact TTL is a Phase-3
 * security parameter); refresh rotates and is bound to the AuthSession so
 * revocation (logout, LP-6 takeover) is immediate (INV-AS-2).
 */
export const TokenPair = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  /** Access-token lifetime in seconds. */
  expiresInSec: z.number().int().positive(),
});
export type TokenPair = z.infer<typeof TokenPair>;

export const LoginResponse = z.object({
  user: User,
  tokens: TokenPair,
  /**
   * True ⇒ the only reachable surface is the change-password flow (INV-U-3);
   * every other endpoint answers 403 auth.password-reset-required.
   */
  mustResetPassword: z.boolean(),
});
export type LoginResponse = z.infer<typeof LoginResponse>;

export const RefreshRequest = z.object({ refreshToken: z.string() });
export type RefreshRequest = z.infer<typeof RefreshRequest>;

export const RefreshResponse = z.object({ tokens: TokenPair });
export type RefreshResponse = z.infer<typeof RefreshResponse>;

/** Serves both voluntary change and the forced first-login reset (LP-2), authenticated end-to-end (B-42 closed). */
export const ChangePasswordRequest = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(256),
});
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequest>;
