/**
 * Bearer/refresh single-flight for the real transport (DR tokens, memory-only).
 *
 * The store observes an app-owned memory token pair — the package never imports
 * app code. On a 401 the coordinator awaits ONE shared refresh for the whole
 * concurrent burst, stores the rotated pair, and retries the original request
 * exactly once. A 401 after the retry, or a failed refresh, clears the tokens
 * and rejects; it never loops.
 */
import type { TokenPair } from '@eduscope/shared';
import type { Unsubscribe } from '../stream.js';
import type { AuthorizedSend, HttpResponseLike } from './http.js';

export interface TokenStore {
  getTokens(): TokenPair | null;
  setTokens(next: TokenPair | null): void;
  clearTokens(): void;
  subscribeTokens(listener: (tokens: TokenPair | null) => void): Unsubscribe;
}

/** A package-internal, memory-only store; identity-change notification only. */
export function createMemoryTokenStore(initial: TokenPair | null = null): TokenStore {
  let tokens = initial;
  const listeners = new Set<(tokens: TokenPair | null) => void>();
  const notify = () => {
    for (const listener of [...listeners]) listener(tokens);
  };
  return {
    getTokens: () => tokens,
    setTokens(next) {
      if (next === tokens) return; // no-op on identity match
      tokens = next;
      notify();
    },
    clearTokens() {
      if (tokens === null) return;
      tokens = null;
      notify();
    },
    subscribeTokens(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export interface AuthCoordinator {
  /** The `authorized` strategy handed to the HTTP transport. */
  readonly authorized: AuthorizedSend;
  accessToken(): string | null;
}

export function createAuthCoordinator(options: {
  store: TokenStore;
  /** Posts the refresh token with NO bearer and returns the rotated pair. */
  refresh: (refreshToken: string) => Promise<TokenPair>;
}): AuthCoordinator {
  const { store, refresh } = options;
  let refreshInFlight: Promise<boolean> | null = null;

  const refreshOnce = (): Promise<boolean> => {
    if (!refreshInFlight) {
      refreshInFlight = (async () => {
        const current = store.getTokens();
        if (!current) return false;
        try {
          const rotated = await refresh(current.refreshToken);
          store.setTokens(rotated);
          return true;
        } catch {
          store.clearTokens(); // terminal refresh failure clears credentials
          return false;
        }
      })();
      // Reset after settle so a genuinely new 401 burst can refresh again.
      void refreshInFlight.finally(() => {
        refreshInFlight = null;
      });
    }
    return refreshInFlight;
  };

  const authorized: AuthorizedSend = async (build, _operation) => {
    const bearer = store.getTokens()?.accessToken ?? null;
    const first = await build(bearer);
    if (first.status !== 401) return first;

    const refreshed = await refreshOnce();
    if (!refreshed) return first; // tokens cleared; parseResponse rejects the 401

    const retryBearer = store.getTokens()?.accessToken ?? null;
    const retry: HttpResponseLike = await build(retryBearer);
    if (retry.status === 401) store.clearTokens();
    return retry;
  };

  return {
    authorized,
    accessToken: () => store.getTokens()?.accessToken ?? null,
  };
}
