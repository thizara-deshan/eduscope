import { zUser, type User } from '@eduscope/shared';
import { SEED_EPOCH, seedId, validated } from './index.js';

/**
 * Two accounts exercise the ordinary paths (`a.perera` lecturer,
 * `admin` admin, neither needs a reset). A third, `n.silva`, carries
 * `mustResetPassword: true` so S-02's forced-reset path (U-7) is reachable
 * from a fresh mock without editing code.
 */
export function createUsersSeed(): User[] {
  const rows: User[] = [
    {
      id: seedId('user-lecturer'),
      username: 'a.perera',
      displayName: 'A. Perera',
      role: 'lecturer',
      source: 'institute',
      mustResetPassword: false,
      disabled: false,
      lastLoginAt: SEED_EPOCH,
      createdAt: SEED_EPOCH,
    },
    {
      id: seedId('user-admin'),
      username: 'admin',
      displayName: 'Device Administrator',
      role: 'admin',
      source: 'local',
      mustResetPassword: false,
      disabled: false,
      lastLoginAt: SEED_EPOCH,
      createdAt: SEED_EPOCH,
    },
    {
      id: seedId('user-silva'),
      username: 'n.silva',
      displayName: 'N. Silva',
      role: 'lecturer',
      source: 'institute',
      mustResetPassword: true,
      disabled: false,
      lastLoginAt: null,
      createdAt: SEED_EPOCH,
    },
  ];
  return rows.map((row) => validated(zUser, row));
}

/**
 * Mock-only credential store — `User` (and therefore `Seed`) never carries a
 * password field (INV-U-1: password hashes never appear in any response), so
 * this lives outside the seed graph and is consumed only by
 * `rest/auth.ts`'s `login`/`changePassword`.
 */
export const SEED_CREDENTIALS: Record<string, string> = {
  'a.perera': 'correct-horse',
  admin: 'battery-staple',
  'n.silva': 'temp-pass-1',
};
