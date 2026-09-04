import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TokenPair } from '@eduscope/shared';
import {
  clearTokens,
  getTokens,
  panelTokenStore,
  setTokens,
  subscribeTokens,
} from './token-store.js';

const pair = (n: number): TokenPair => ({ accessToken: `a-${n}`, refreshToken: `r-${n}`, expiresInSec: 900 });

afterEach(() => {
  clearTokens();
});

describe('panel token store', () => {
  it('holds the pair in memory only', () => {
    expect(getTokens()).toBeNull();
    setTokens(pair(1));
    expect(getTokens()).toEqual(pair(1));
    clearTokens();
    expect(getTokens()).toBeNull();
  });

  it('notifies subscribers only on identity change', () => {
    const listener = vi.fn();
    const off = subscribeTokens(listener);
    const p = pair(1);
    setTokens(p);
    setTokens(p); // same identity → no notify
    setTokens(pair(2)); // new identity → notify
    clearTokens();
    clearTokens(); // already null → no notify
    off();
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('exposes a TokenStore view backed by the same memory', () => {
    panelTokenStore.setTokens(pair(5));
    expect(getTokens()).toEqual(pair(5));
    expect(panelTokenStore.getTokens()).toEqual(pair(5));
    panelTokenStore.clearTokens();
    expect(getTokens()).toBeNull();
  });
});
