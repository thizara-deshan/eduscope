import type { TokenPair } from '@eduscope/shared';

/**
 * In memory ONLY, deliberately (W1-D-3). The panel is a shared lecture-hall
 * kiosk and PF-17 issues short-lived tokens: a token in localStorage outlives
 * the lecturer who typed it, which is the same argument S-01 §8 makes for
 * `autoComplete="off"`. A reload returning to S-01 is correct behaviour on a
 * device the next person walks up to.
 *
 * Nothing READS these in Wave 1 — the mock ignores bearer tokens and
 * `createRealClient` is a Phase-4 stub. They are captured rather than dropped
 * because a silent drop is what makes a later "why is every request
 * unauthenticated" bug expensive to find.
 */
let tokens: TokenPair | null = null;

export const setTokens = (next: TokenPair | null): void => {
  tokens = next;
};
export const getTokens = (): TokenPair | null => tokens;
export const clearTokens = (): void => {
  tokens = null;
};
