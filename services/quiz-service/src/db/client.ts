import postgres, { type Sql } from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';

export type QuizDb = PostgresJsDatabase<typeof schema>;

/** Owns one postgres.js pool plus its Drizzle wrapper. */
export interface QuizDatabase {
  readonly db: QuizDb;
  readonly sql: Sql;
  close(): Promise<void>;
}

/** Opens `url` with a bounded connection pool. */
export function openDatabase(url: string): QuizDatabase {
  const sql = postgres(url, { max: 10 });
  const db = drizzle(sql, { schema });

  return {
    db,
    sql,
    async close(): Promise<void> {
      await sql.end({ timeout: 5 });
    },
  };
}
