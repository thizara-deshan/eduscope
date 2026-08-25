import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Sql } from 'postgres';

export const DEFAULT_MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../migrations');

// Arbitrary fixed key: only used to serialize concurrent `migrate()` callers
// against each other, never against application traffic.
const ADVISORY_LOCK_KEY = 785_213_001;

/**
 * Applies every `.sql` file in `migrationsDir`, in name order, inside one
 * transaction guarded by a transaction-scoped advisory lock. Idempotent — a
 * migration already recorded in `quiz_schema_migrations` is skipped unless
 * its checksum has changed, in which case this throws rather than silently
 * re-applying or ignoring drift.
 */
export async function migrate(sql: Sql, migrationsDir: string): Promise<void> {
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_KEY}::bigint)`;

    await tx`
      CREATE TABLE IF NOT EXISTS quiz_schema_migrations (
        name text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL
      )
    `;

    for (const file of files) {
      const contents = readFileSync(join(migrationsDir, file), 'utf8');
      const checksum = createHash('sha256').update(contents).digest('hex');

      const existing = await tx`
        SELECT checksum FROM quiz_schema_migrations WHERE name = ${file}
      `;

      if (existing.length > 0) {
        if (existing[0]?.checksum !== checksum) {
          throw new Error(`migration "${file}" has changed since it was applied (checksum mismatch)`);
        }
        continue;
      }

      await tx.unsafe(contents);
      await tx`
        INSERT INTO quiz_schema_migrations (name, checksum, applied_at)
        VALUES (${file}, ${checksum}, now())
      `;
    }
  });
}
