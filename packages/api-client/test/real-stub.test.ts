import { describe, expect, it } from 'vitest';
import { PANEL_OPERATION_IDS } from '@eduscope/shared';
import { createRealClient } from '../src/index.js';
import type { FetchLike, HttpResponseLike } from '../src/real/http.js';

/**
 * Since E-02 the real client's REST operations are LIVE, and since E-03 so is
 * the panel socket (`events$`/`connection$`/`resync`). E-04 also wires the
 * authenticated JPEG preview poller.
 */
const neverCalled: FetchLike = async () => {
  throw new Error('fetch should not run in this test');
};

describe('createRealClient REST surface is live', () => {
  const client = createRealClient('http://localhost:8080/api/v1', {
    fetch: neverCalled,
  }) as unknown as Record<string, (...a: unknown[]) => unknown>;

  it.each(PANEL_OPERATION_IDS)('%s is a callable method, not a NotImplemented throw', (id) => {
    expect(typeof client[id]).toBe('function');
  });
});

describe('createRealClient preview surface is live', () => {
  const okFetch: FetchLike = async (): Promise<HttpResponseLike> => ({
    ok: true,
    status: 200,
    headers: { get: (name) => name.toLowerCase() === 'content-type' ? 'image/jpeg' : null },
    json: async () => ({}),
    text: async () => '',
    blob: async () => new Blob([Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }),
  });
  const client = createRealClient('http://localhost:8080/api/v1', {
    fetch: okFetch,
    webSocket: () => {
      throw new Error('no socket in this test');
    },
  });

  it('openPreview returns a closeable role-bound channel', async () => {
    const channel = client.openPreview('presentation');
    expect(channel.updates$.subscribe).toEqual(expect.any(Function));
    channel.close();
    await Promise.resolve();
  });
});
