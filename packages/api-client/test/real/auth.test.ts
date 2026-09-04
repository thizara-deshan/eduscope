import { describe, expect, it, vi } from 'vitest';
import type { TokenPair } from '@eduscope/shared';
import {
  createAuthCoordinator,
  createMemoryTokenStore,
} from '../../src/real/auth.js';
import type { HttpResponseLike } from '../../src/real/http.js';

const ok = (): HttpResponseLike =>
  ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({}), text: async () => '', blob: async () => new Blob() });
const unauthorized = (): HttpResponseLike =>
  ({ ok: false, status: 401, headers: { get: () => null }, json: async () => ({}), text: async () => '', blob: async () => new Blob() });

const pair = (n: number): TokenPair => ({ accessToken: `access-${n}`, refreshToken: `refresh-${n}`, expiresInSec: 900 });

describe('memory token store', () => {
  it('notifies only on identity change', () => {
    const store = createMemoryTokenStore();
    const listener = vi.fn();
    store.subscribeTokens(listener);
    const p = pair(1);
    store.setTokens(p);
    store.setTokens(p); // same identity — no notify
    store.clearTokens();
    store.clearTokens(); // already null — no notify
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('auth coordinator', () => {
  it('sends the current bearer and does not refresh on success', async () => {
    const store = createMemoryTokenStore(pair(1));
    const refresh = vi.fn(async () => pair(2));
    const { authorized } = createAuthCoordinator({ store, refresh });
    const build = vi.fn(async (bearer: string | null) => {
      expect(bearer).toBe('access-1');
      return ok();
    });
    const response = await authorized(build, 'getMe');
    expect(response.status).toBe(200);
    expect(refresh).not.toHaveBeenCalled();
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('refreshes once for a concurrent 401 burst and retries each request once', async () => {
    const store = createMemoryTokenStore(pair(1));
    let releaseRefresh: (p: TokenPair) => void = () => {};
    const refresh = vi.fn(
      (_rt: string) => new Promise<TokenPair>((resolve) => (releaseRefresh = resolve)),
    );
    const { authorized } = createAuthCoordinator({ store, refresh });

    // Each request 401s on the first attempt, succeeds on the retry.
    const makeBuild = () => {
      let calls = 0;
      return vi.fn(async () => {
        calls += 1;
        return calls === 1 ? unauthorized() : ok();
      });
    };
    const builds = Array.from({ length: 20 }, makeBuild);
    const pending = builds.map((build) => authorized(build, 'getMe'));

    // All 20 first attempts have 401'd and are awaiting the single refresh.
    await Promise.resolve();
    releaseRefresh(pair(2));
    const results = await Promise.all(pending);

    expect(refresh).toHaveBeenCalledTimes(1); // one refresh for the whole burst
    expect(store.getTokens()).toEqual(pair(2)); // rotation stored
    for (const result of results) expect(result.status).toBe(200);
    for (const build of builds) expect(build).toHaveBeenCalledTimes(2); // one retry each
  });

  it('clears tokens and stops when refresh fails terminally', async () => {
    const store = createMemoryTokenStore(pair(1));
    const refresh = vi.fn(async () => {
      throw new Error('refresh rejected');
    });
    const { authorized } = createAuthCoordinator({ store, refresh });
    const build = vi.fn(async () => unauthorized());
    const response = await authorized(build, 'getMe');
    expect(response.status).toBe(401); // the original 401 is surfaced
    expect(store.getTokens()).toBeNull(); // credentials cleared
    expect(build).toHaveBeenCalledTimes(1); // no retry after a failed refresh
  });

  it('clears tokens when the retry still 401s and never loops', async () => {
    const store = createMemoryTokenStore(pair(1));
    const refresh = vi.fn(async () => pair(2));
    const { authorized } = createAuthCoordinator({ store, refresh });
    const build = vi.fn(async () => unauthorized()); // always 401
    const response = await authorized(build, 'getMe');
    expect(response.status).toBe(401);
    expect(build).toHaveBeenCalledTimes(2); // first + one retry, then stop
    expect(store.getTokens()).toBeNull();
  });
});
