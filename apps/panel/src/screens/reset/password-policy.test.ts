import { describe, expect, it } from 'vitest';
import { zChangePasswordRequest } from '@eduscope/shared';
import { PASSWORD_MAX_LENGTH, PASSWORD_RULES, meetsPolicy } from './password-policy.js';

/** The corpus deliberately includes one case per lookahead plus both bounds. */
const CORPUS = [
  'Passw0rdd',        // compliant
  'Aa1aaaaa',         // compliant, exactly 8
  'Aa1aaaa',          // 7 — too short
  'password1',        // no uppercase
  'PASSWORD1',        // no lowercase
  'Passworddd',       // no digit
  '',                 // empty
  'temp-pass-1',      // the seeded temp credential: no uppercase
  `Aa1${'a'.repeat(254)}`, // 257 — over maxLength
];

describe('password-policy mirrors the contract (CG-12 / A-3)', () => {
  it.each(CORPUS)('agrees with zChangePasswordRequest on %j', (candidate) => {
    // `confirm` is matched so the client-only `match confirm` rule never
    // decides the comparison — the server has no such rule.
    const client = meetsPolicy(candidate, candidate);
    const server = zChangePasswordRequest.safeParse({
      currentPassword: 'whatever', newPassword: candidate,
    }).success;
    expect(client, `client and server disagree on ${JSON.stringify(candidate)}`).toBe(server);
  });

  it('renders five rules, in the order S-02 §6 lists them', () => {
    expect(PASSWORD_RULES.map((r) => r.id)).toEqual(['length', 'digit', 'upper', 'lower', 'match']);
    expect(PASSWORD_RULES.map((r) => r.label)).toEqual([
      'be 8+ characters', 'include a number', 'include a capital letter',
      'include a small letter', 'match confirm',
    ]);
  });

  it('fails match-confirm without failing the server rule', () => {
    expect(meetsPolicy('Passw0rdd', 'Passw0rdX')).toBe(false);
    expect(PASSWORD_RULES.find((r) => r.id === 'match')!.test('Passw0rdd', 'Passw0rdd')).toBe(true);
  });

  it('states the contract ceiling once', () => {
    expect(PASSWORD_MAX_LENGTH).toBe(256);
  });
});
