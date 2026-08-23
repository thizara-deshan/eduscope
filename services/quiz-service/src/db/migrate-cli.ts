import postgres from 'postgres';
import { loadConfig } from '../config.js';
import { DEFAULT_MIGRATIONS_DIR, migrate } from './migrate.js';

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const sql = postgres(config.databaseUrl, { max: 1 });
  try {
    await migrate(sql, DEFAULT_MIGRATIONS_DIR);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
