import { zUser, type User } from '@eduscope/shared';
import { SEED_EPOCH, validated } from './index.js';

// User identity must outlive a disposable mock world: the panel's auth
// context remains mounted while the developer overlay calls switchScenario().
const USER_IDS = {
  lecturer: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  admin: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
  silva: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
  fonseka: '01ARZ3NDEKTSV4RRFFQ69G5FAY',
} as const;

/**
 * Two accounts exercise the ordinary paths (`a.perera` lecturer,
 * `admin` admin, neither needs a reset). A third, `n.silva`, carries
 * `mustResetPassword: true` so S-02's forced-reset path (U-7) is reachable
 * from a fresh mock without editing code. A fourth, `r.fonseka`, carries
 * `disabled: true` so S-01's `disabled account` state — `401
 * auth.account-disabled`, contract v0.2 (CG-10 / S01-D-3) — is reachable the
 * same way, with a known-good password so the refusal is genuinely about the
 * account and not about the credentials.
 */
export function createUsersSeed(): User[] {
  const rows: User[] = [
    {
      id: USER_IDS.lecturer,
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
      id: USER_IDS.admin,
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
      id: USER_IDS.silva,
      username: 'n.silva',
      displayName: 'N. Silva',
      role: 'lecturer',
      source: 'institute',
      mustResetPassword: true,
      disabled: false,
      lastLoginAt: null,
      createdAt: SEED_EPOCH,
    },
    {
      id: USER_IDS.fonseka,
      username: 'r.fonseka',
      displayName: 'R. Fonseka',
      role: 'lecturer',
      source: 'institute',
      mustResetPassword: false,
      disabled: true,
      lastLoginAt: SEED_EPOCH,
      createdAt: SEED_EPOCH,
    },
  ];
  return rows.map((row) => validated(zUser, row));
}

/**
 * Mock-only credential store — `User` (and therefore `Seed`) never carries a
 * password field (INV-U-1: password hashes never appear in any response), so
 * this lives outside the seed graph. It is consumed by `rest/auth.ts`
 * (`login`, `changePassword`) and `rest/users.ts` (`createUser`, `updateUser`),
 * all of which reach it through `RestContext.credentials`.
 *
 * It is a **factory, not a module constant**. `changePassword` and `updateUser`
 * mutate the store in place; as a shared module-level object that mutation
 * outlived the mock client that caused it, so one password change leaked into
 * every later `createMockClient()` in the same process — the same trap
 * `createSeed()` avoids by rebuilding the entity graph per client. Minting a
 * fresh map per client keeps a mock instance's whole world disposable.
 */
export type CredentialStore = Record<string, string>;

export function createCredentialStore(): CredentialStore {
  return {
    'a.perera': 'correct-horse',
    admin: 'battery-staple',
    'n.silva': 'temp-pass-1',
    'r.fonseka': 'Correct-horse-9',
  };
}
