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
