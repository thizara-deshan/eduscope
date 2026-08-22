import Database, { type Database as BetterSqlite3Database } from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

export type DrizzleDb = BetterSQLite3Database<typeof schema>;

/** Owns one `better-sqlite3` connection plus its Drizzle wrapper (D-03 single-writer funnel). */
export interface CoreDatabase {
  readonly db: DrizzleDb;
  readonly raw: BetterSqlite3Database;
  close(): void;
}

/** Opens `path` with the engine configuration mandated by design/core-api.md §3.1. */
export function openDatabase(path: string): CoreDatabase {
  const raw = new Database(path);
  raw.pragma('journal_mode = WAL');
  raw.pragma('foreign_keys = ON');
  raw.pragma('synchronous = NORMAL');
  raw.pragma('busy_timeout = 5000');

  const db = drizzle(raw, { schema });

  return {
    db,
    raw,
    close(): void {
      raw.close();
    },
  };
}
