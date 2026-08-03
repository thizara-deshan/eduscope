import {
  zPage, zLogEntry,
  type LogCategory, type LogEntry, type LogLevel, type Page, type Ulid,
} from '@eduscope/shared';
import { validated } from '../seed/index.js';
import { requireAdmin } from './auth.js';
import type { RestContext } from './index.js';

const DEFAULT_LIMIT = 50;

interface LogFilter {
  readonly level?: LogLevel;
  readonly category?: LogCategory;
  readonly q?: string;
  readonly from?: string;
  readonly to?: string;
  readonly sessionId?: Ulid;
}

function applyFilter(rows: LogEntry[], filter: LogFilter): LogEntry[] {
  let out = rows;
  if (filter.level) out = out.filter((l) => l.level === filter.level);
  if (filter.category) out = out.filter((l) => l.category === filter.category);
  if (filter.sessionId) out = out.filter((l) => l.sessionId === filter.sessionId);
  if (filter.q) {
    const needle = filter.q.toLowerCase();
    out = out.filter((l) => l.message.toLowerCase().includes(needle));
  }
  if (filter.from) out = out.filter((l) => l.at >= filter.from!);
  if (filter.to) out = out.filter((l) => l.at <= filter.to!);
  return out;
}

export function createLogsOperations(ctx: RestContext) {
  const { seed } = ctx;

  return {
    queryLogs: async (query?: LogFilter & { cursor?: string; limit?: number }): Promise<Page<LogEntry>> => {
      requireAdmin(ctx);
      const rows = applyFilter(seed.logs, query ?? {});
      const limit = query?.limit ?? DEFAULT_LIMIT;
      const start = query?.cursor ? Number.parseInt(query.cursor, 10) : 0;
      const page = rows.slice(start, start + limit);
      const nextCursor = start + limit < rows.length ? String(start + limit) : null;
      return validated(zPage(zLogEntry), { items: page, nextCursor });
    },

    exportLogsCsv: async (query?: LogFilter): Promise<string> => {
      requireAdmin(ctx);
      const rows = applyFilter(seed.logs, query ?? {});
      const header = 'id,at,level,category,service,message,sessionId,userId';
      const lines = rows.map((l) =>
        [l.id, l.at, l.level, l.category, l.service, JSON.stringify(l.message), l.sessionId ?? '', l.userId ?? ''].join(','),
      );
      return [header, ...lines].join('\n');
    },
  };
}
