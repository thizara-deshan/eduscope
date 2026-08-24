import { chmodSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const outIndex = process.argv.indexOf('--output');
const output = outIndex >= 0 ? process.argv[outIndex + 1] : undefined;
const databaseUrl = process.env.DATABASE_URL;
if (!output || !databaseUrl) throw new Error('require --output and DATABASE_URL');
const target = resolve(output);
if (existsSync(target)) throw new Error('backup output already exists');
const result = spawnSync('pg_dump', ['--format=custom', '--no-owner', '--file', target, databaseUrl], {
  shell: false,
  stdio: ['ignore', 'inherit', 'inherit'],
});
if (result.status !== 0) process.exit(result.status ?? 1);
chmodSync(target, 0o600);
if (statSync(target).size === 0) throw new Error('pg_dump produced an empty backup');
process.stdout.write(`${target}\n`);
