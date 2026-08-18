import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate as runMigrations } from 'drizzle-orm/better-sqlite3/migrator';
import type { CoreDatabase } from './client.js';

const MIGRATIONS_FOLDER = resolve(dirname(fileURLToPath(import.meta.url)), '../../migrations');

/** Applies pending migrations. Idempotent — a second call against an up-to-date DB is a no-op. */
export function migrate(core: CoreDatabase): void {
  runMigrations(core.db, { migrationsFolder: MIGRATIONS_FOLDER });
}
