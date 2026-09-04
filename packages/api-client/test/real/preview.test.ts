import { describe, expect, it, vi } from 'vitest';
import type { PreviewUpdate } from '../../src/client.js';
import { createVirtualClock } from '../../src/mock/clock.js';
import { createMemoryTokenStore } from '../../src/real/auth.js';
import { createRealClient } from '../../src/real/create-real-client.js';
import type { FetchLike, HttpResponseLike } from '../../src/real/http.js';
import { createPreviewPoller, type PreviewRequest } from '../../src/real/preview.js';

const jpeg = (tail = 0) => new Blob([
  Uint8Array.from([0xff, 0xd8, 0xff, tail, 0xff, 0xd9]),
], { type: 'image/jpeg' });

const flush = async () => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

describe('real JPEG preview poller', () => {
  it('requests immediately, cache-busts every second, and publishes complete JPEGs', async () => {
    const clock = createVirtualClock('2026-09-04T10:00:00.000Z');
    const request = vi.fn(async (_input: PreviewRequest) => jpeg(request.mock.calls.length));
    const channel = createPreviewPoller({ roleId: 'presentation', request, clock });
    const seen: PreviewUpdate[] = [];
    channel.updates$.subscribe((update) => seen.push(update));

    await flush();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]![0]).toMatchObject({ roleId: 'presentation' });
    expect(seen.at(-1)).toMatchObject({ kind: 'frame', stale: false });

    clock.advance(1_000);
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]![0].cacheBust).not.toBe(request.mock.calls[0]![0].cacheBust);
    channel.close();
  });

  it('never overlaps requests and skips ticks while one is unresolved', async () => {
    const clock = createVirtualClock('2026-09-04T10:00:00.000Z');
    let resolve!: (blob: Blob) => void;
    const request = vi.fn(() => new Promise<Blob>((done) => { resolve = done; }));
    const channel = createPreviewPoller({ roleId: 'presentation', request, clock });
    expect(request).toHaveBeenCalledTimes(1);
    clock.advance(4_000);
    expect(request).toHaveBeenCalledTimes(1);
    resolve(jpeg());
    await flush();
    clock.advance(1_000);
    expect(request).toHaveBeenCalledTimes(2);
    channel.close();
  });

  it('rejects non-JPEG and partial JPEG payloads without replacing the last frame', async () => {
    const clock = createVirtualClock('2026-09-04T10:00:00.000Z');
    const responses = [
      new Blob(['not jpeg'], { type: 'text/plain' }),
      new Blob([Uint8Array.from([0xff, 0xd8, 0x00])], { type: 'image/jpeg' }),
      jpeg(1),
    ];
    const request = vi.fn(async () => responses.shift()!);
    const channel = createPreviewPoller({ roleId: 'presentation', request, clock });
    const seen: PreviewUpdate[] = [];
    channel.updates$.subscribe((update) => seen.push(update));
    await flush();
    clock.advance(1_000);
    await flush();
    clock.advance(1_000);
    await flush();
    expect(seen.filter((update) => update.kind === 'error')).toHaveLength(2);
    expect(seen.filter((update) => update.kind === 'frame')).toHaveLength(1);
    channel.close();
  });

  it('becomes stale after three seconds without success and recovers on a valid JPEG', async () => {
    const clock = createVirtualClock('2026-09-04T10:00:00.000Z');
    let fail = false;
    const request = vi.fn(async () => {
      if (fail) throw new Error('offline');
      return jpeg(request.mock.calls.length);
    });
    const channel = createPreviewPoller({ roleId: 'presentation', request, clock });
    const seen: PreviewUpdate[] = [];
    channel.updates$.subscribe((update) => seen.push(update));
    await flush();
    fail = true;
    clock.advance(3_000);
    await flush();
    expect(seen.at(-1)).toMatchObject({ kind: 'stale' });
    fail = false;
    clock.advance(1_000);
    await flush();
    expect(seen.at(-1)).toMatchObject({ kind: 'frame', stale: false });
    channel.close();
  });

  it('aborts once, clears timers, and ignores a late resolution after idempotent close', async () => {
    const clock = createVirtualClock('2026-09-04T10:00:00.000Z');
    let resolve!: (blob: Blob) => void;
    let signal!: AbortSignal;
    const request = vi.fn((input: { signal: AbortSignal }) => {
      signal = input.signal;
      return new Promise<Blob>((done) => { resolve = done; });
    });
    const channel = createPreviewPoller({ roleId: 'presentation', request, clock });
    const seen: PreviewUpdate[] = [];
    channel.updates$.subscribe((update) => seen.push(update));
    channel.close();
    channel.close();
    expect(signal.aborted).toBe(true);
    resolve(jpeg());
    await flush();
    clock.advance(10_000);
    expect(request).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([]);
  });

  it('uses authenticated no-store HTTP, supersedes the active source, and never opens preview WS', async () => {
    const clock = createVirtualClock('2026-09-04T10:00:00.000Z');
    const requests: Array<{ url: string; init: Parameters<FetchLike>[1] }> = [];
    const response = (): HttpResponseLike => ({
      ok: true,
      status: 200,
      headers: { get: (name) => name.toLowerCase() === 'content-type' ? 'image/jpeg' : null },
      json: async () => ({}),
      text: async () => '',
      blob: async () => jpeg(requests.length),
    });
    let resolveFirst!: (value: HttpResponseLike) => void;
    const fetch: FetchLike = async (url, init) => {
      requests.push({ url, init });
      if (requests.length === 1) {
        return new Promise<HttpResponseLike>((resolve) => { resolveFirst = resolve; });
      }
      return response();
    };
    const webSocket = vi.fn(() => { throw new Error('preview must not open a websocket'); });
    const peer = vi.fn();
    vi.stubGlobal('RTCPeerConnection', peer);
    const client = createRealClient('http://device/api/v1', {
      fetch,
      clock,
      tokenStore: createMemoryTokenStore({
        accessToken: 'access', refreshToken: 'refresh', expiresInSec: 900,
      }),
      webSocket,
    });
    const first = client.openPreview('presentation');
    const second = client.openPreview('lecturer-cam');
    await flush();

    expect(requests).toHaveLength(2);
    expect(requests[0]!.url).toMatch(/^http:\/\/device\/api\/v1\/sources\/presentation\/preview\.jpg\?preview=/);
    expect(requests[1]!.url).toMatch(/^http:\/\/device\/api\/v1\/sources\/lecturer-cam\/preview\.jpg\?preview=/);
    expect(requests[0]!.init.cache).toBe('no-store');
    expect(requests[0]!.init.headers.get('authorization')).toBe('Bearer access');
    expect(requests[0]!.init.signal?.aborted).toBe(true);
    expect(webSocket).not.toHaveBeenCalled();
    expect(peer).not.toHaveBeenCalled();
    resolveFirst(response());
    await flush();
    first.close();
    second.close();
    client.dispose();
  });
});
