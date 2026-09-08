import type { TokenPair } from '@eduscope/shared';
import type { TokenStore } from '@eduscope/api-client';

/**
 * In memory ONLY, deliberately (W1-D-3). The panel is a shared lecture-hall
 * kiosk and PF-17 issues short-lived tokens: a token in localStorage outlives
 * the lecturer who typed it, which is the same argument S-01 §8 makes for
 * `autoComplete="off"`. A reload returning to S-01 is correct behaviour on a
 * device the next person walks up to.
 *
 * The real adapter (E-02+) observes this store through `panelTokenStore`: it
 * reads the access token for every bearer, reacts to rotation, and clears
 * credentials on terminal refresh failure. Subscription notifies only on an
 * identity change so a no-op `setTokens(sameRef)` never churns sockets.
 */
let tokens: TokenPair | null = null;
const listeners = new Set<(tokens: TokenPair | null) => void>();

const notify = (): void => {
  for (const listener of [...listeners]) listener(tokens);
};

export const setTokens = (next: TokenPair | null): void => {
  if (next === tokens) return;
  tokens = next;
  notify();
};
export const getTokens = (): TokenPair | null => tokens;
export const clearTokens = (): void => {
  if (tokens === null) return;
  tokens = null;
  notify();
};
export const subscribeTokens = (
  listener: (tokens: TokenPair | null) => void,
): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** The `TokenStore` view handed to `createRealClient`. */
export const panelTokenStore: TokenStore = {
  getTokens,
  setTokens,
  clearTokens,
  subscribeTokens,
};
