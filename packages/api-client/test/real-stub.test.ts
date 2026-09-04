import { describe, expect, it } from 'vitest';
import { PANEL_OPERATION_IDS } from '@eduscope/shared';
import { NotImplementedError, createRealClient } from '../src/index.js';
import type { FetchLike, HttpResponseLike } from '../src/real/http.js';

/**
 * Since E-02 the real client's REST operations are LIVE — they build and send a
 * request rather than throwing. What is still an honest Phase-4 stub is the
 * realtime surface (`events$`/`connection$`/`openPreview`/`resync`), wired in
 * E-03/E-04.
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

describe('createRealClient realtime surface is still an honest stub', () => {
  const okFetch: FetchLike = async (): Promise<HttpResponseLike> => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({}),
    text: async () => '',
    blob: async () => new Blob(),
  });
  const client = createRealClient('http://localhost:8080/api/v1', { fetch: okFetch });

  it('events$ subscription throws NotImplementedError until E-03', () => {
    expect(() =>
      (client.events$ as unknown as { subscribe: () => void }).subscribe(),
    ).toThrow(NotImplementedError);
  });

  it('openPreview throws NotImplementedError until E-04', () => {
    expect(() => client.openPreview()).toThrow(NotImplementedError);
  });
});
