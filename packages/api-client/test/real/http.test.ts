import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ProblemError, TransportError } from '../../src/errors.js';
import {
  buildQuery,
  createHttpTransport,
  joinUrl,
  type AuthorizedSend,
  type FetchLike,
  type HttpResponseLike,
} from '../../src/real/http.js';
import { fillPath } from '../../src/real/operation-specs.js';

function fakeResponse(opts: {
  status?: number;
  body?: unknown;
  contentType?: string | null;
}): HttpResponseLike {
  const status = opts.status ?? 200;
  const contentType = opts.contentType === undefined ? 'application/json' : opts.contentType;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? contentType : null) },
    json: vi.fn(async () => opts.body),
    text: vi.fn(async () => (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body))),
    blob: vi.fn(async () => new Blob([typeof opts.body === 'string' ? opts.body : ''])),
  };
}

/** authorized = a single pass-through attempt with a fixed bearer. */
function transportWith(fetchImpl: FetchLike, bearer: string | null = 'tok') {
  const authorized: AuthorizedSend = (build) => build(bearer);
  return createHttpTransport({ baseUrl: 'http://host/api/v1', fetch: fetchImpl, authorized });
}

const okSchema = z.object({ value: z.string() });

describe('url and query assembly', () => {
  it('joins base and path without producing //', () => {
    expect(joinUrl('http://host/api/v1/', '/auth/login')).toBe('http://host/api/v1/auth/login');
    expect(joinUrl('/api/v1', 'auth/login')).toBe('/api/v1/auth/login');
  });

  it('percent-encodes path ids', () => {
    expect(fillPath('/recordings/{id}', { id: 'a b/c' })).toBe('/recordings/a%20b%2Fc');
  });

  it('rejects a missing path placeholder', () => {
    expect(() => fillPath('/recordings/{id}', {})).toThrow(/missing path parameter/);
  });

  it('omits undefined query values and encodes the rest', () => {
    expect(buildQuery({ a: 1, b: undefined, c: 'x y' })).toBe('?a=1&c=x%20y');
    expect(buildQuery(undefined)).toBe('');
  });

  it('does not mutate its query input across repeated calls', () => {
    const query = { a: 1, b: undefined };
    buildQuery(query);
    buildQuery(query);
    expect(query).toEqual({ a: 1, b: undefined });
  });
});

describe('request building', () => {
  it('sets application/json for a JSON body and attaches the bearer', async () => {
    let seen: { url: string; init: { method: string; headers: Headers; body?: BodyInit } } | null = null;
    const fetchImpl: FetchLike = async (url, init) => {
      seen = { url, init };
      return fakeResponse({ body: { value: 'ok' } });
    };
    await transportWith(fetchImpl, 'bearer-123').request({
      operation: 'createUser',
      method: 'POST',
      path: '/users',
      body: { username: 'x' },
      response: okSchema,
    });
    expect(seen!.url).toBe('http://host/api/v1/users');
    expect(seen!.init.headers.get('content-type')).toBe('application/json');
    expect(seen!.init.headers.get('authorization')).toBe('Bearer bearer-123');
    expect(seen!.init.body).toBe(JSON.stringify({ username: 'x' }));
  });

  it('never sets a content-type by hand for multipart FormData', async () => {
    let headers: Headers | null = null;
    const fetchImpl: FetchLike = async (_url, init) => {
      headers = init.headers;
      return fakeResponse({ body: { value: 'ok' } });
    };
    const form = new FormData();
    form.append('file', new Blob(['a']), 'roster.xlsx');
    await transportWith(fetchImpl).request({
      operation: 'importUsers',
      method: 'POST',
      path: '/users/import',
      body: form,
      response: okSchema,
    });
    expect(headers!.get('content-type')).toBeNull();
  });

  it('omits Authorization on an auth:none request even when a token exists', async () => {
    let headers: Headers | null = null;
    const fetchImpl: FetchLike = async (_url, init) => {
      headers = init.headers;
      return fakeResponse({ body: { value: 'ok' } });
    };
    await transportWith(fetchImpl, 'a-token').request({
      operation: 'login',
      method: 'POST',
      path: '/auth/login',
      body: { username: 'u', password: 'p' },
      response: okSchema,
      auth: 'none',
    });
    expect(headers!.get('authorization')).toBeNull();
  });
});

describe('response handling', () => {
  it('parses a 200 JSON body against the response schema', async () => {
    const fetchImpl: FetchLike = async () => fakeResponse({ body: { value: 'hi' } });
    const result = await transportWith(fetchImpl).request({
      operation: 'getMe',
      method: 'GET',
      path: '/auth/me',
      response: okSchema,
    });
    expect(result).toEqual({ value: 'hi' });
  });

  it('accepts a 202 accepted body', async () => {
    const fetchImpl: FetchLike = async () => fakeResponse({ status: 202, body: { value: 'queued' } });
    const result = await transportWith(fetchImpl).request({
      operation: 'startRecording',
      method: 'POST',
      path: '/recording/start',
      response: okSchema,
    });
    expect(result).toEqual({ value: 'queued' });
  });

  it('returns a Blob for a blob response', async () => {
    const fetchImpl: FetchLike = async () => fakeResponse({ body: 'JPEGBYTES', contentType: 'image/jpeg' });
    const result = await transportWith(fetchImpl).request({
      operation: 'getSourcePreview',
      method: 'GET',
      path: '/sources/presentation/preview.jpg',
      response: 'blob',
    });
    expect(result).toBeInstanceOf(Blob);
  });

  it('returns text for a text response (CSV export)', async () => {
    const fetchImpl: FetchLike = async () => fakeResponse({ body: 'a,b,c', contentType: 'text/csv' });
    const result = await transportWith(fetchImpl).request({
      operation: 'exportLogsCsv',
      method: 'GET',
      path: '/logs/export',
      response: 'text',
    });
    expect(result).toBe('a,b,c');
  });

  it('never reads a body for a 204 void response', async () => {
    const response = fakeResponse({ status: 204, body: undefined, contentType: null });
    const fetchImpl: FetchLike = async () => response;
    const result = await transportWith(fetchImpl).request({
      operation: 'logout',
      method: 'POST',
      path: '/auth/logout',
      response: 'void',
    });
    expect(result).toBeUndefined();
    expect(response.json).not.toHaveBeenCalled();
  });

  it('surfaces a named application/problem+json as ProblemError', async () => {
    const problem = { code: 'auth.invalid-credentials', status: 401, title: 'Bad credentials' };
    const fetchImpl: FetchLike = async () =>
      fakeResponse({ status: 401, body: problem, contentType: 'application/problem+json' });
    await expect(
      transportWith(fetchImpl).request({
        operation: 'login',
        method: 'POST',
        path: '/auth/login',
        response: okSchema,
        auth: 'none',
      }),
    ).rejects.toBeInstanceOf(ProblemError);
  });

  it('treats a malformed Problem body as a TransportError', async () => {
    const fetchImpl: FetchLike = async () =>
      fakeResponse({ status: 500, body: { nope: true }, contentType: 'application/problem+json' });
    await expect(
      transportWith(fetchImpl).request({
        operation: 'getMe',
        method: 'GET',
        path: '/auth/me',
        response: okSchema,
      }),
    ).rejects.toBeInstanceOf(TransportError);
  });

  it('treats a non-2xx with no problem body as a TransportError', async () => {
    const fetchImpl: FetchLike = async () => fakeResponse({ status: 502, body: '', contentType: 'text/html' });
    await expect(
      transportWith(fetchImpl).request({
        operation: 'getMe',
        method: 'GET',
        path: '/auth/me',
        response: okSchema,
      }),
    ).rejects.toBeInstanceOf(TransportError);
  });

  it('rejects a success body that fails its response schema', async () => {
    const fetchImpl: FetchLike = async () => fakeResponse({ body: { value: 42 } });
    await expect(
      transportWith(fetchImpl).request({
        operation: 'getMe',
        method: 'GET',
        path: '/auth/me',
        response: okSchema,
      }),
    ).rejects.toBeInstanceOf(TransportError);
  });

  it('wraps a network/abort failure as a TransportError naming the operation', async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error('network down');
    };
    const error = await transportWith(fetchImpl)
      .request({ operation: 'getMe', method: 'GET', path: '/auth/me', response: okSchema })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TransportError);
    expect((error as TransportError).operation).toBe('getMe');
  });
});
