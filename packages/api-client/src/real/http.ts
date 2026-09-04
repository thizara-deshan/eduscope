/**
 * The real REST fetch boundary. It owns URL assembly, header construction, body
 * encoding, and response/Problem validation — and nothing else. Bearer/refresh
 * lives in `auth.ts`; this module is handed an already-authorized `send`.
 *
 * Contract rules (frontend-conventions §5, openapi Conventions):
 *  - `encodeURIComponent` is used ONLY for path values (done in `fillPath`) and
 *    query values here; base/path joining never produces `//`.
 *  - success bodies are parsed against the operation's response schema before
 *    returning; a 204 never calls `.json()`.
 *  - only transport/parse failures become `TransportError`; a NAMED Problem is
 *    surfaced as `ProblemError` and is never re-wrapped.
 */
import type { z } from 'zod';
import type { PanelOperationId } from '@eduscope/shared';
import { ProblemError, TransportError } from '../errors.js';
import type { HttpMethod } from './operation-specs.js';
import { isProblemContentType, parseProblem } from './problems.js';

export type QueryValue = string | number | boolean | undefined;

export interface HttpRequest<T> {
  operation: PanelOperationId;
  method: HttpMethod;
  /** Path with `{placeholders}` already substituted by `fillPath`. */
  path: string;
  query?: Record<string, QueryValue> | undefined;
  /** JSON-serialized unless it is `FormData` (multipart, no manual boundary). */
  body?: unknown;
  response: z.ZodType<T> | 'blob' | 'text' | 'void';
  auth?: 'required' | 'none';
  cache?: RequestCache;
  signal?: AbortSignal;
}

export interface HttpResponseLike {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
  blob(): Promise<Blob>;
}

export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Headers;
    body?: BodyInit;
    signal?: AbortSignal;
    cache?: RequestCache;
  },
) => Promise<HttpResponseLike>;

/** Authorizes and sends one attempt; may retry once internally (401 refresh). */
export type AuthorizedSend = (
  build: (bearer: string | null) => Promise<HttpResponseLike>,
  operation: PanelOperationId,
) => Promise<HttpResponseLike>;

export interface HttpTransport {
  request<T>(req: HttpRequest<T>): Promise<T>;
}

export function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

export function buildQuery(query?: Record<string, QueryValue>): string {
  if (!query) return '';
  const parts: string[] = [];
  for (const key of Object.keys(query)) {
    const value = query[key];
    if (value === undefined) continue; // omit undefined values entirely
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

export function createHttpTransport(options: {
  baseUrl: string;
  fetch: FetchLike;
  authorized: AuthorizedSend;
}): HttpTransport {
  const { baseUrl, fetch: fetchImpl, authorized } = options;

  const send = (req: HttpRequest<unknown>, url: string) => async (
    bearer: string | null,
  ): Promise<HttpResponseLike> => {
    // A FRESH Headers per attempt — a refresh retry must not reuse a stale one.
    const headers = new Headers();
    const isForm = typeof FormData !== 'undefined' && req.body instanceof FormData;
    if (req.body !== undefined && !isForm) {
      headers.set('content-type', 'application/json');
    }
    // Multipart: never set content-type by hand — the boundary must be the
    // runtime's, so let fetch derive it from the FormData body.
    if (req.auth !== 'none' && bearer) headers.set('authorization', `Bearer ${bearer}`);
    const init: {
      method: string;
      headers: Headers;
      body?: BodyInit;
      signal?: AbortSignal;
      cache?: RequestCache;
    } = { method: req.method, headers };
    if (req.signal) init.signal = req.signal;
    if (req.cache) init.cache = req.cache;
    if (req.body !== undefined) {
      init.body = isForm ? (req.body as FormData) : JSON.stringify(req.body);
    }
    return fetchImpl(url, init);
  };

  return {
    async request<T>(req: HttpRequest<T>): Promise<T> {
      const url = joinUrl(baseUrl, req.path) + buildQuery(req.query);
      const builder = send(req as HttpRequest<unknown>, url);

      let response: HttpResponseLike;
      try {
        response =
          req.auth === 'none'
            ? await builder(null)
            : await authorized(builder, req.operation);
      } catch (error) {
        if (error instanceof ProblemError) throw error;
        throw new TransportError(req.operation, { cause: error });
      }

      return parseResponse(req, response);
    },
  };
}

async function parseResponse<T>(
  req: HttpRequest<T>,
  response: HttpResponseLike,
): Promise<T> {
  if (!response.ok) {
    if (isProblemContentType(response.headers.get('content-type'))) {
      let body: unknown;
      try {
        body = await response.json();
      } catch (error) {
        throw new TransportError(req.operation, { cause: error });
      }
      const problem = parseProblem(body);
      if (!problem) throw new TransportError(req.operation);
      throw new ProblemError(problem);
    }
    throw new TransportError(req.operation);
  }

  // 204 / void: never read a body.
  if (req.response === 'void') return undefined as T;
  if (req.response === 'blob') return (await response.blob()) as T;
  if (req.response === 'text') return (await response.text()) as T;

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw new TransportError(req.operation, { cause: error });
  }
  const parsed = req.response.safeParse(body);
  if (!parsed.success) throw new TransportError(req.operation, { cause: parsed.error });
  return parsed.data;
}
