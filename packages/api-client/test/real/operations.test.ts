import { describe, expect, it } from 'vitest';
import {
  PANEL_OPERATION_IDS,
  SERVER_SIDE_ONLY_OPERATION_IDS,
} from '@eduscope/shared';
import { createRealClient, createMemoryTokenStore } from '../../src/index.js';
import type { FetchLike, HttpResponseLike } from '../../src/real/http.js';

const ULID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const CMD = { commandId: ULID, acceptedAt: '2026-09-04T00:00:00.000Z', resolveBySec: 10 };
const USER = {
  id: ULID,
  username: 'a.perera',
  displayName: 'A. Perera',
  role: 'lecturer',
  source: 'institute',
  mustResetPassword: false,
  disabled: false,
  lastLoginAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};
const IMPORT = {
  id: ULID,
  filename: 'roster.xlsx',
  uploadedAt: '2026-09-04T00:00:00.000Z',
  state: 'applied',
  rowCount: 1,
  acceptedCount: 1,
  rejections: [],
};

interface Captured {
  method: string;
  url: string;
  body?: BodyInit | undefined;
}

function jsonResponse(body: unknown, status = 200): HttpResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n) => (n.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    blob: async () => new Blob([typeof body === 'string' ? body : '']),
  };
}

function textResponse(body: string): HttpResponseLike {
  return {
    ok: true,
    status: 200,
    headers: { get: (n) => (n.toLowerCase() === 'content-type' ? 'text/csv' : null) },
    json: async () => body,
    text: async () => body,
    blob: async () => new Blob([body]),
  };
}

function noContent(): HttpResponseLike {
  return {
    ok: true,
    status: 204,
    headers: { get: () => null },
    json: async () => {
      throw new Error('204 must not read a body');
    },
    text: async () => '',
    blob: async () => new Blob(),
  };
}

/** Routes by `${METHOD} ${pathname}` and records every request. */
function harness(routes: Record<string, () => HttpResponseLike>) {
  const captured: Captured[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    captured.push({ method: init.method, url, body: init.body });
    const pathname = url.replace('http://host/api/v1', '').split('?')[0];
    const handler = routes[`${init.method} ${pathname}`];
    if (!handler) throw new Error(`unrouted ${init.method} ${pathname}`);
    return handler();
  };
  const store = createMemoryTokenStore({ accessToken: 'a', refreshToken: 'r', expiresInSec: 900 });
  const client = createRealClient('http://host/api/v1', { fetch: fetchImpl, tokenStore: store });
  return { client, captured, store };
}

describe('real client operation coverage', () => {
  it('implements a function for all 79 panel operations', () => {
    const record = createRealClient('http://host/api/v1', {
      fetch: (async () => jsonResponse({})) as FetchLike,
    }) as unknown as Record<string, unknown>;
    const missing = PANEL_OPERATION_IDS.filter((id) => typeof record[id] !== 'function');
    expect(missing).toEqual([]);
    expect(PANEL_OPERATION_IDS).toHaveLength(79);
  });

  it('never carries the four server-only quiz-sync operations', () => {
    const record = createRealClient('http://host/api/v1', {
      fetch: (async () => jsonResponse({})) as FetchLike,
    }) as unknown as Record<string, unknown>;
    for (const id of SERVER_SIDE_ONLY_OPERATION_IDS) expect(id in record).toBe(false);
  });
});

describe('representative verbs', () => {
  it('GET /auth/me validates the User body', async () => {
    const { client, captured } = harness({ 'GET /auth/me': () => jsonResponse(USER) });
    const me = await client.getMe();
    expect(me.username).toBe('a.perera');
    expect(captured[0]).toMatchObject({ method: 'GET', url: 'http://host/api/v1/auth/me' });
  });

  it('POST /recording/start returns CommandAccepted', async () => {
    const { client, captured } = harness({ 'POST /recording/start': () => jsonResponse(CMD, 202) });
    const accepted = await client.startRecording();
    expect(accepted.commandId).toBe(ULID);
    expect(captured[0]!.body).toBeUndefined();
  });

  it('PUT /audio/controls/{roleId} substitutes the path and JSON-encodes the body', async () => {
    const { client, captured } = harness({
      'PUT /audio/controls/mic-lecturer': () => jsonResponse(CMD),
    });
    await client.updateAudioControl('mic-lecturer', { muted: true } as never);
    expect(captured[0]).toMatchObject({ method: 'PUT', url: 'http://host/api/v1/audio/controls/mic-lecturer' });
    expect(captured[0]!.body).toBe(JSON.stringify({ muted: true }));
  });

  it('PATCH /users/{userId} returns the updated User', async () => {
    const { client, captured } = harness({ [`PATCH /users/${ULID}`]: () => jsonResponse(USER) });
    const user = await client.updateUser(ULID, { displayName: 'X' } as never);
    expect(user.id).toBe(ULID);
    expect(captured[0]!.method).toBe('PATCH');
  });

  it('DELETE /users/{userId} is a 204 void', async () => {
    const { client } = harness({ [`DELETE /users/${ULID}`]: () => noContent() });
    await expect(client.deleteUser(ULID)).resolves.toBeUndefined();
  });

  it('POST /users/import sends multipart FormData', async () => {
    const { client, captured } = harness({ 'POST /users/import': () => jsonResponse(IMPORT) });
    const batch = await client.importUsers({ file: new Blob(['x']) as unknown as File });
    expect(batch.state).toBe('applied');
    expect(captured[0]!.body).toBeInstanceOf(FormData);
  });

  it('GET blob preview returns a Blob', async () => {
    const { client } = harness({
      'GET /sources/presentation/preview.jpg': () => jsonResponse('JPEG'),
    });
    const blob = await client.getSourcePreview('presentation' as never);
    expect(blob).toBeInstanceOf(Blob);
  });

  it('GET /logs/export returns CSV text', async () => {
    const { client } = harness({ 'GET /logs/export': () => textResponse('a,b\n1,2') });
    await expect(client.exportLogsCsv()).resolves.toBe('a,b\n1,2');
  });

  it('encodes query parameters and omits undefined ones', async () => {
    const { client, captured } = harness({
      'GET /logs': () => jsonResponse({ items: [], nextCursor: null }),
    });
    await client.queryLogs({ level: 'ERROR', q: 'x y' });
    expect(captured[0]!.url).toBe('http://host/api/v1/logs?level=ERROR&q=x%20y');
  });

  it('clears tokens after a 204 logout', async () => {
    const { client, store } = harness({ 'POST /auth/logout': () => noContent() });
    expect(store.getTokens()).not.toBeNull();
    await client.logout();
    expect(store.getTokens()).toBeNull();
  });
});
