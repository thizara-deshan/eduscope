import type { LogCategory, LogEntry, LogLevel } from '@eduscope/shared';
import { and, asc, desc, eq, gte, lte, lt, or, sql } from 'drizzle-orm';
import { ProblemError } from '../../contracts/problem.js';
import type { DrizzleDb } from '../../db/client.js';
import { logEntries } from '../../db/schema.js';
import type { Clock } from '../../lib/clock.js';
import type { DomainBus } from '../../lib/domain-bus.js';
import type { IdGenerator } from '../../lib/ids.js';

const MS_PER_DAY = 86_400_000;

export interface LogStoreDeps {
  db: DrizzleDb;
  clock: Clock;
  ids: IdGenerator;
  bus: DomainBus;
  /** Rotation policy (deployment config, never product-visible — design/core-api.md §12). */
  maxRows: number;
  maxAgeDays: number;
}

export interface LogWriteInput {
  level: LogLevel;
  category: LogCategory;
  service: LogEntry['service'];
  message: string;
  context?: Record<string, unknown> | null;
  sessionId?: string | null;
  userId?: string | null;
}

export interface LogQuery {
  level?: LogLevel | undefined;
  category?: LogCategory | undefined;
  q?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  sessionId?: string | undefined;
  cursor?: string | undefined;
  limit: number;
}

export interface LogQueryResult {
  items: LogEntry[];
  nextCursor: string | null;
}

interface LogCursor {
  at: string;
  id: string;
}

function encodeLogCursor(cursor: LogCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeLogCursor(raw: string): LogCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw new ProblemError(422, 'validation.invalid', 'Invalid cursor');
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).at !== 'string' ||
    typeof (parsed as Record<string, unknown>).id !== 'string'
  ) {
    throw new ProblemError(422, 'validation.invalid', 'Invalid cursor');
  }
  return parsed as LogCursor;
}

function toPublic(row: typeof logEntries.$inferSelect): LogEntry {
  return {
    id: row.id,
    at: row.at,
    level: row.level,
    category: row.category,
    service: row.service,
    message: row.message,
    context: (row.context as Record<string, unknown> | null) ?? null,
    sessionId: row.sessionId,
    userId: row.userId,
  };
}

/**
 * The curated AD-7 log store (design/core-api.md §12, INV-LE-1/INV-LE-2):
 * the single `write()` helper every future producer calls, which persists an
 * append-only row and bridges it onto the bus as `log.entry` for subscribed
 * live tails (B-35's hub already reserves the augmentation this reuses).
 * Rotation is a policy, never a delete-on-demand feature — it runs after
 * every write, oldest-first by both row count and age.
 */
export class LogStore {
  readonly #deps: LogStoreDeps;

  constructor(deps: LogStoreDeps) {
    this.#deps = deps;
  }

  write(input: LogWriteInput): LogEntry {
    const now = this.#deps.clock.now();
    const row = {
      id: this.#deps.ids.next(now),
      at: now.toISOString(),
      level: input.level,
      category: input.category,
      service: input.service,
      message: input.message,
      context: input.context ?? null,
      sessionId: input.sessionId ?? null,
      userId: input.userId ?? null,
    };
    this.#deps.db.insert(logEntries).values(row).run();
    this.#rotate();

    const entry: LogEntry = row;
    this.#deps.bus.publish('log.entry', entry);
    return entry;
  }

  query(filter: LogQuery): LogQueryResult {
    const conditions = [];
    if (filter.level !== undefined) conditions.push(eq(logEntries.level, filter.level));
    if (filter.category !== undefined) conditions.push(eq(logEntries.category, filter.category));
    if (filter.sessionId !== undefined) conditions.push(eq(logEntries.sessionId, filter.sessionId));
    if (filter.from !== undefined) conditions.push(gte(logEntries.at, filter.from));
    if (filter.to !== undefined) conditions.push(lte(logEntries.at, filter.to));
    if (filter.q !== undefined && filter.q.length > 0) {
      conditions.push(sql`lower(${logEntries.message}) like ${`%${filter.q.toLowerCase()}%`}`);
    }
    if (filter.cursor !== undefined) {
      const cursor = decodeLogCursor(filter.cursor);
      conditions.push(or(lt(logEntries.at, cursor.at), and(eq(logEntries.at, cursor.at), lt(logEntries.id, cursor.id))));
    }

    const rows = this.#deps.db
      .select({
        id: logEntries.id,
        at: logEntries.at,
        level: logEntries.level,
        category: logEntries.category,
        service: logEntries.service,
        message: logEntries.message,
        context: logEntries.context,
        sessionId: logEntries.sessionId,
        userId: logEntries.userId,
      })
      .from(logEntries)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(logEntries.at), desc(logEntries.id))
      .limit(filter.limit + 1)
      .all();

    const page = rows.slice(0, filter.limit);
    const nextCursor =
      rows.length > filter.limit ? encodeLogCursor({ at: page[page.length - 1]!.at, id: page[page.length - 1]!.id }) : null;

    return { items: page.map(toPublic), nextCursor };
  }

  /** Deletes rows older than the age policy, then trims any excess beyond the row-count policy — oldest first in both passes (INV-LE-1). */
  rotate(): void {
    this.#rotate();
  }

  #rotate(): void {
    const now = this.#deps.clock.now();
    const cutoff = new Date(now.getTime() - this.#deps.maxAgeDays * MS_PER_DAY).toISOString();
    this.#deps.db.delete(logEntries).where(lt(logEntries.at, cutoff)).run();

    const count = this.#deps.db.select({ value: sql<number>`count(*)` }).from(logEntries).get()?.value ?? 0;
    const excess = count - this.#deps.maxRows;
    if (excess <= 0) return;

    const doomed = this.#deps.db
      .select({ id: logEntries.id })
      .from(logEntries)
      .orderBy(asc(logEntries.at), asc(logEntries.id))
      .limit(excess)
      .all();
    for (const victim of doomed) {
      this.#deps.db.delete(logEntries).where(eq(logEntries.id, victim.id)).run();
    }
  }
}
