import { timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import type { LogEntry } from '@eduscope/shared';
import { zUlid } from '@eduscope/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ProblemError } from '../../contracts/problem.js';
import { parseBody } from '../../contracts/validate.js';
import { requireAuth } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import type { ScopedSubscriptionRegistry } from '../export/subscriptions.js';
import type { LogQuery, LogStore } from './store.js';

const zLogFilter = z.object({
  level: z.enum(['INFO', 'WARN', 'ERROR']).optional(),
  category: z.enum(['Auth', 'System', 'Hardware', 'Session']).optional(),
  q: z.string().max(256).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  sessionId: zUlid.optional(),
});

const zQueryLogsQuery = zLogFilter.extend({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const DEFAULT_QUERY_LOGS_LIMIT = 100;
const CSV_BATCH_SIZE = 500;
const CSV_COLUMNS = ['id', 'at', 'level', 'category', 'service', 'message', 'context', 'sessionId', 'userId'] as const;

function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toCsvRow(entry: LogEntry): string {
  return CSV_COLUMNS.map((column) => {
    const value = entry[column];
    if (value === null || value === undefined) return '';
    return escapeCsvField(typeof value === 'string' ? value : JSON.stringify(value));
  }).join(',');
}

/** Reads the store one bounded page at a time (design/core-api.md §12) so the CSV response never buffers full history in memory. */
async function* streamCsvRows(store: LogStore, filter: Omit<LogQuery, 'limit' | 'cursor'>): AsyncGenerator<string> {
  yield `${CSV_COLUMNS.join(',')}\r\n`;
  let cursor: string | undefined;
  for (;;) {
    const page = store.query({ ...filter, cursor, limit: CSV_BATCH_SIZE });
    for (const entry of page.items) {
      yield `${toCsvRow(entry)}\r\n`;
    }
    if (page.nextCursor === null) return;
    cursor = page.nextCursor;
  }
}

function assertAdmin(role: string): void {
  if (role !== 'admin') throw new ProblemError(403, 'not-authorized', 'Administrator role required');
}

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function isLoopbackAddress(address: string | undefined): boolean {
  return address !== undefined && LOOPBACK_ADDRESSES.has(address);
}

/** Constant-time bearer compare (mirrors `secrets.compare_digest` used across the C services, eduscope_ai_common/auth.py) — a length mismatch alone must not short-circuit via timing. */
function bearerMatches(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) {
    // Compare against a same-length buffer anyway so the length check itself
    // is the only branch that isn't constant-time; the value never matches
    // wrong-length input regardless (no shortcut through timingSafeEqual's
    // own length assertion, which throws for mismatched lengths).
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * C execution gate item 5 (design/core-api.md §12): pipeline-manager and the
 * AI services have no domain persistence of their own — they call this
 * loopback-only, bearer-protected sink so their curated product-log rows go
 * through the same `LogStore` (and the same `log.entry` bus bridge) as every
 * core-api-originated row, keeping `service` attribution honest without
 * exposing this write path beyond localhost.
 */
const zInternalLogWrite = z
  .object({
    level: z.enum(['INFO', 'WARN', 'ERROR']),
    category: z.enum(['Auth', 'System', 'Hardware', 'Session']),
    service: z.enum(['core-api', 'pipeline-manager', 'ai', 'deploy', 'quiz-sync']),
    message: z.string().min(1),
    context: z.record(z.string(), z.unknown()).nullable().optional(),
    sessionId: zUlid.nullable().optional(),
  })
  .strict();

/** Matches eduscope_ai_common's `configure_logging` denylist (workstream-c-ai-services.md C-01 Step 5) — reject rather than silently store a context key that looks like it carries a secret or raw content. */
const SECRET_SHAPED_CONTEXT_KEY = /token|secret|password|prompt|transcript|llmendpoint/i;

export function registerInternalLogRoutes(app: FastifyInstance, store: LogStore, internalBearer: string): void {
  app.post('/internal/logs', async (request, reply) => {
    if (!isLoopbackAddress(request.socket.remoteAddress ?? undefined)) {
      throw new ProblemError(403, 'not-authorized', 'This endpoint accepts loopback connections only');
    }

    const header = request.headers.authorization;
    const parts = typeof header === 'string' ? header.split(' ') : [];
    if (parts.length !== 2 || parts[0] !== 'Bearer' || parts[1]!.length === 0 || !bearerMatches(parts[1]!, internalBearer)) {
      throw new ProblemError(401, 'not-authorized', 'Unauthorized');
    }

    const body = parseBody(zInternalLogWrite, request.body);
    for (const key of Object.keys(body.context ?? {})) {
      if (SECRET_SHAPED_CONTEXT_KEY.test(key)) {
        throw new ProblemError(422, 'validation.invalid', 'Validation failed', { detail: `context.${key} looks secret-shaped and is rejected` });
      }
    }

    const entry = store.write({
      level: body.level,
      category: body.category,
      service: body.service,
      message: body.message,
      context: body.context ?? null,
      sessionId: body.sessionId ?? null,
    });
    reply.code(201).send(entry);
  });
}

/** Registers the M10 observability operationIds this task owns (openapi.yaml tag `logs`): `queryLogs`, `exportLogsCsv`. */
export function registerObservabilityRoutes(app: FastifyInstance, authService: AuthService, store: LogStore, subscriptions: ScopedSubscriptionRegistry): void {
  app.get(
    '/api/v1/logs',
    { config: { operationId: 'queryLogs' }, preHandler: requireAuth(authService, 'queryLogs') },
    async (request, reply) => {
      assertAdmin(request.authContext!.role);
      const query = parseBody(zQueryLogsQuery, request.query);
      subscriptions.refresh(request.authContext!.authSessionId, 'log.entry');
      const result = store.query({
        level: query.level,
        category: query.category,
        q: query.q,
        from: query.from,
        to: query.to,
        sessionId: query.sessionId,
        cursor: query.cursor,
        limit: query.limit ?? DEFAULT_QUERY_LOGS_LIMIT,
      });
      reply.code(200).send(result);
    },
  );

  app.get(
    '/api/v1/logs/export',
    { config: { operationId: 'exportLogsCsv' }, preHandler: requireAuth(authService, 'exportLogsCsv') },
    async (request, reply) => {
      assertAdmin(request.authContext!.role);
      const query = parseBody(zLogFilter, request.query);
      reply.code(200).type('text/csv');
      return reply.send(Readable.from(streamCsvRows(store, query)));
    },
  );
}
