/**
 * The ONE client mirror of `ChangePasswordRequest.newPassword` as amended by
 * contract v0.2 (CG-12 / S02-D-1): minLength 8, maxLength 256, and
 * `^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)`. Legacy parity with B-42 — these users
 * already meet this rule today.
 *
 * The checklist renders whatever this exports, so changing the policy is a
 * one-constant edit and never a relayout (S-02 §4). `password-policy.test.ts`
 * asserts this file and the generated schema accept and reject the same set; if
 * they ever disagree the checklist is lying, which is the one defect S-02
 * cannot tolerate.
 */
export interface PasswordRule {
  readonly id: 'length' | 'digit' | 'upper' | 'lower' | 'match';
  readonly label: string;
  test(value: string, confirm: string): boolean;
}

export const PASSWORD_RULES: readonly PasswordRule[] = [
  { id: 'length', label: 'be 8+ characters', test: (v) => v.length >= 8 },
  { id: 'digit', label: 'include a number', test: (v) => /\d/.test(v) },
  { id: 'upper', label: 'include a capital letter', test: (v) => /[A-Z]/.test(v) },
  { id: 'lower', label: 'include a small letter', test: (v) => /[a-z]/.test(v) },
  { id: 'match', label: 'match confirm', test: (v, c) => v.length > 0 && v === c },
];

/**
 * The contract's `maxLength`. NOT a checklist row — a rule the user cannot
 * plausibly hit does not earn 24 px beside four they can — but it is part of
 * the mirror, so `meetsPolicy` enforces it and the New/Confirm inputs cap input
 * at this length.
 */
export const PASSWORD_MAX_LENGTH = 256;

export const meetsPolicy = (newPassword: string, confirm: string): boolean =>
  newPassword.length <= PASSWORD_MAX_LENGTH &&
  PASSWORD_RULES.every((rule) => rule.test(newPassword, confirm));
