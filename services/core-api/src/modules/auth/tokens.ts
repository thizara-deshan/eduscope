import { createHash, randomBytes } from 'node:crypto';

/** The only claims an access token carries (openapi.yaml §Global Constraints: "10-minute access claims {sub,role,sid}"). */
export interface AccessTokenClaims {
  sub: string;
  role: 'lecturer' | 'admin';
  sid: string;
}

/** One JWT boundary the rest of the module depends on; `app.ts` wires this to `@fastify/jwt`. */
export interface AccessTokenSigner {
  sign(claims: AccessTokenClaims): string;
  verify(token: string): AccessTokenClaims;
}

/** Opaque bearer token stored only as its SHA-256 hash (never the raw value, INV-U-1 sibling for refresh tokens). */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
