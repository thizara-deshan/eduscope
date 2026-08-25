import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import postgres from 'postgres';

const valueAfter = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const input = valueAfter('--input');
const confirm = valueAfter('--confirm');
const allowNonempty = process.argv.includes('--allow-nonempty');
const databaseUrl = process.env.DATABASE_URL;
if (!input || !databaseUrl || confirm !== 'RESTORE-EDUSCOPE-QUIZ') throw new Error('restore confirmation/input/database missing');
const source = resolve(input);
if (!existsSync(source)) throw new Error('backup input does not exist');

const sql = postgres(databaseUrl, { max: 1 });
try {
  const rows = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM pg_catalog.pg_tables
    WHERE schemaname='public' AND tablename <> 'quiz_schema_migrations'
  `;
  if ((rows[0]?.count ?? 0) > 0 && !allowNonempty) throw new Error('target database is not empty');
} finally {
  await sql.end();
}
const result = spawnSync('pg_restore', [
  '--exit-on-error', '--clean', '--if-exists', '--no-owner', '--dbname', databaseUrl, source,
], { shell: false, stdio: ['ignore', 'inherit', 'inherit'] });
if (result.status !== 0) process.exit(result.status ?? 1);
