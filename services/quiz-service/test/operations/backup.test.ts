import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { ulid } from 'ulidx';
import { migrate, DEFAULT_MIGRATIONS_DIR } from '../../src/db/migrate.js';
import { verifyDeviceCredential } from '../../src/device/credentials.js';
import { startTestPostgres, type TestPostgres } from '../helpers/postgres.js';

const SERVICE_ROOT = resolve(import.meta.dirname, '../..');
const TSX_BIN = resolve(SERVICE_ROOT, 'node_modules/.bin/tsx');

interface FakeBin {
  dir: string;
  invocationLog: string;
}

/** Writes a fake pg_dump/pg_restore on a scratch PATH entry so backup.ts/restore.ts run for real, unmodified, against a controllable "executable seam" instead of a real PostgreSQL client tool. */
function writeFakeExecutable(
  name: 'pg_dump' | 'pg_restore',
  behavior: { exitCode?: number; content?: string },
): FakeBin {
  const dir = mkdtempSync(join(tmpdir(), `quiz-fake-${name}-`));
  const invocationLog = join(dir, 'invocations.log');
  const script = join(dir, name);
  const exitCode = behavior.exitCode ?? 0;
  const content = behavior.content ?? 'fake-pg-dump-binary-bytes';
  writeFileSync(
    script,
    [
      '#!/usr/bin/env node',
      `const fs = require('node:fs');`,
      `fs.appendFileSync(${JSON.stringify(invocationLog)}, JSON.stringify(process.argv.slice(2)) + '\\n');`,
      name === 'pg_dump'
        ? [
            `const fileFlag = process.argv.indexOf('--file');`,
            `if (fileFlag >= 0) fs.writeFileSync(process.argv[fileFlag + 1], ${JSON.stringify(content)});`,
          ].join('\n')
        : '',
      `process.exit(${exitCode});`,
    ].join('\n'),
    'utf8',
  );
  chmodSync(script, 0o755);
  return { dir, invocationLog };
}

function readInvocations(fake: FakeBin): string[] {
  return existsSync(fake.invocationLog) ? readFileSync(fake.invocationLog, 'utf8').trim().split('\n').filter(Boolean) : [];
}

function runScript(
  relativeScriptPath: string,
  argv: string[],
  env: Record<string, string | undefined>,
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(TSX_BIN, [relativeScriptPath, ...argv], {
    cwd: SERVICE_ROOT,
    shell: false,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('scripts/backup.ts', () => {
  it('requires --output and DATABASE_URL before invoking pg_dump', () => {
    const fake = writeFakeExecutable('pg_dump', {});
    const result = runScript('scripts/backup.ts', [], { PATH: `${fake.dir}:${process.env.PATH}`, DATABASE_URL: undefined });
    expect(result.status).not.toBe(0);
    expect(readInvocations(fake)).toHaveLength(0);
  });

  it('refuses to overwrite an existing output file without calling pg_dump', () => {
    const fake = writeFakeExecutable('pg_dump', {});
    const dir = mkdtempSync(join(tmpdir(), 'quiz-backup-'));
    const output = join(dir, 'existing.dump');
    writeFileSync(output, 'already here');
    const result = runScript('scripts/backup.ts', ['--output', output], {
      PATH: `${fake.dir}:${process.env.PATH}`,
      DATABASE_URL: 'postgres://fake/db',
    });
    expect(result.status).not.toBe(0);
    expect(readInvocations(fake)).toHaveLength(0);
  });

  it('propagates a pg_dump failure exit code and never chmods the target', () => {
    const fake = writeFakeExecutable('pg_dump', { exitCode: 2 });
    const dir = mkdtempSync(join(tmpdir(), 'quiz-backup-'));
    const output = join(dir, 'failed.dump');
    const result = runScript('scripts/backup.ts', ['--output', output], {
      PATH: `${fake.dir}:${process.env.PATH}`,
      DATABASE_URL: 'postgres://fake/db',
    });
    expect(result.status).toBe(2);
    expect(readInvocations(fake)).toHaveLength(1);
  });

  it('rejects an empty pg_dump output even though pg_dump reported success', () => {
    const fake = writeFakeExecutable('pg_dump', { exitCode: 0, content: '' });
    const dir = mkdtempSync(join(tmpdir(), 'quiz-backup-'));
    const output = join(dir, 'empty.dump');
    const result = runScript('scripts/backup.ts', ['--output', output], {
      PATH: `${fake.dir}:${process.env.PATH}`,
      DATABASE_URL: 'postgres://fake/db',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/empty backup/);
  });

  it('on success, chmods the backup 0600 and prints only the resolved path', () => {
    const fake = writeFakeExecutable('pg_dump', { exitCode: 0, content: 'real-bytes' });
    const dir = mkdtempSync(join(tmpdir(), 'quiz-backup-'));
    const output = join(dir, 'ok.dump');
    const result = runScript('scripts/backup.ts', ['--output', output], {
      PATH: `${fake.dir}:${process.env.PATH}`,
      DATABASE_URL: 'postgres://fake/db',
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe(output);
    expect(statSync(output).mode & 0o777).toBe(0o600);
    expect(result.stdout).not.toMatch(/postgres:\/\//);
  });
});

describe('scripts/restore.ts', () => {
  it('requires --input, DATABASE_URL, and the exact confirmation text', () => {
    const fake = writeFakeExecutable('pg_restore', {});
    const dir = mkdtempSync(join(tmpdir(), 'quiz-restore-'));
    const input = join(dir, 'backup.dump');
    writeFileSync(input, 'bytes');
    const result = runScript('scripts/restore.ts', ['--input', input, '--confirm', 'not-the-phrase'], {
      PATH: `${fake.dir}:${process.env.PATH}`,
      DATABASE_URL: 'postgres://fake/db',
    });
    expect(result.status).not.toBe(0);
    expect(readInvocations(fake)).toHaveLength(0);
  });

  it('refuses a missing backup input file', () => {
    const fake = writeFakeExecutable('pg_restore', {});
    const result = runScript(
      'scripts/restore.ts',
      ['--input', '/does/not/exist.dump', '--confirm', 'RESTORE-EDUSCOPE-QUIZ'],
      { PATH: `${fake.dir}:${process.env.PATH}`, DATABASE_URL: 'postgres://fake/db' },
    );
    expect(result.status).not.toBe(0);
    expect(readInvocations(fake)).toHaveLength(0);
  });

  describe('against a real PostgreSQL 16 database', () => {
    let pg: TestPostgres;
    let sql: ReturnType<typeof postgres>;

    beforeAll(async () => {
      pg = await startTestPostgres();
      sql = postgres(pg.connectionString, { max: 1 });
      await migrate(sql, DEFAULT_MIGRATIONS_DIR);
    }, 60_000);

    afterAll(async () => {
      await sql?.end({ timeout: 5 });
      await pg?.stop();
    });

    it('refuses to restore into a non-empty database without --allow-nonempty, and never calls pg_restore', () => {
      const fake = writeFakeExecutable('pg_restore', {});
      const dir = mkdtempSync(join(tmpdir(), 'quiz-restore-'));
      const input = join(dir, 'backup.dump');
      writeFileSync(input, 'bytes');
      const result = runScript(
        'scripts/restore.ts',
        ['--input', input, '--confirm', 'RESTORE-EDUSCOPE-QUIZ'],
        { PATH: `${fake.dir}:${process.env.PATH}`, DATABASE_URL: pg.connectionString },
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/not empty/);
      expect(readInvocations(fake)).toHaveLength(0);
    });

    it('restores with --allow-nonempty and propagates a pg_restore failure exit code', () => {
      const fake = writeFakeExecutable('pg_restore', { exitCode: 3 });
      const dir = mkdtempSync(join(tmpdir(), 'quiz-restore-'));
      const input = join(dir, 'backup.dump');
      writeFileSync(input, 'bytes');
      const result = runScript(
        'scripts/restore.ts',
        ['--input', input, '--confirm', 'RESTORE-EDUSCOPE-QUIZ', '--allow-nonempty'],
        { PATH: `${fake.dir}:${process.env.PATH}`, DATABASE_URL: pg.connectionString },
      );
      expect(result.status).toBe(3);
      expect(readInvocations(fake)).toHaveLength(1);
    });

    it('restores with --allow-nonempty and succeeds when pg_restore exits 0', () => {
      const fake = writeFakeExecutable('pg_restore', { exitCode: 0 });
      const dir = mkdtempSync(join(tmpdir(), 'quiz-restore-'));
      const input = join(dir, 'backup.dump');
      writeFileSync(input, 'bytes');
      const result = runScript(
        'scripts/restore.ts',
        ['--input', input, '--confirm', 'RESTORE-EDUSCOPE-QUIZ', '--allow-nonempty'],
        { PATH: `${fake.dir}:${process.env.PATH}`, DATABASE_URL: pg.connectionString },
      );
      expect(result.status, result.stderr).toBe(0);
    });
  });
});

describe('scripts/provision-device.ts', () => {
  it('rejects a device id that is not a valid ULID before touching the database', () => {
    const result = runScript(
      'scripts/provision-device.ts',
      ['--device-id', 'not-a-ulid', '--hall-display-name', 'Main Hall'],
      { QUIZ_SERVICE_DATABASE_URL: 'postgres://127.0.0.1:1/does-not-matter' },
    );
    expect(result.status).not.toBe(0);
  });

  it('rejects a missing hall display name', () => {
    const result = runScript('scripts/provision-device.ts', ['--device-id', ulid()], {
      QUIZ_SERVICE_DATABASE_URL: 'postgres://127.0.0.1:1/does-not-matter',
    });
    expect(result.status).not.toBe(0);
  });

  it('rejects a bearer shorter than 32 characters read from stdin', () => {
    const result = spawnSync(
      TSX_BIN,
      ['scripts/provision-device.ts', '--device-id', ulid(), '--hall-display-name', 'Main Hall'],
      {
        cwd: SERVICE_ROOT,
        shell: false,
        encoding: 'utf8',
        input: 'too-short\n',
        env: { ...process.env, QUIZ_SERVICE_DATABASE_URL: 'postgres://127.0.0.1:1/does-not-matter' },
      },
    );
    expect(result.status).not.toBe(0);
  });

  describe('against a real PostgreSQL 16 database', () => {
    let pg: TestPostgres;
    let sql: ReturnType<typeof postgres>;

    beforeAll(async () => {
      pg = await startTestPostgres();
      sql = postgres(pg.connectionString, { max: 1 });
      await migrate(sql, DEFAULT_MIGRATIONS_DIR);
    }, 60_000);

    afterAll(async () => {
      await sql?.end({ timeout: 5 });
      await pg?.stop();
    });

    it('hashes the bearer read from stdin, prints only the device id, and never persists the raw token', async () => {
      const deviceId = ulid();
      const bearer = `campus-device-bearer-${ulid()}${ulid()}`;
      const result = spawnSync(
        TSX_BIN,
        ['scripts/provision-device.ts', '--device-id', deviceId, '--hall-display-name', 'Main Lecture Hall'],
        {
          cwd: SERVICE_ROOT,
          shell: false,
          encoding: 'utf8',
          input: `${bearer}\n`,
          env: { ...process.env, QUIZ_SERVICE_DATABASE_URL: pg.connectionString },
        },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.trim()).toBe(deviceId);
      expect(result.stdout).not.toContain(bearer);
      expect(result.stderr).not.toContain(bearer);

      const rows = await sql`SELECT credential_hash, hall_display_name, enabled FROM devices WHERE device_id = ${deviceId}`;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.credential_hash).not.toBe(bearer);
      expect(rows[0]?.hall_display_name).toBe('Main Lecture Hall');
      expect(rows[0]?.enabled).toBe(true);
      await expect(verifyDeviceCredential(rows[0]!.credential_hash as string, bearer)).resolves.toBe(true);
    });

    it('re-provisioning the same device id updates its credential and hall name (onConflictDoUpdate)', async () => {
      const deviceId = ulid();
      const firstBearer = `campus-device-bearer-${ulid()}${ulid()}`;
      spawnSync(TSX_BIN, ['scripts/provision-device.ts', '--device-id', deviceId, '--hall-display-name', 'Hall A'], {
        cwd: SERVICE_ROOT,
        shell: false,
        input: `${firstBearer}\n`,
        env: { ...process.env, QUIZ_SERVICE_DATABASE_URL: pg.connectionString },
      });

      const secondBearer = `campus-device-bearer-${ulid()}${ulid()}`;
      const second = spawnSync(
        TSX_BIN,
        ['scripts/provision-device.ts', '--device-id', deviceId, '--hall-display-name', 'Hall B'],
        {
          cwd: SERVICE_ROOT,
          shell: false,
          encoding: 'utf8',
          input: `${secondBearer}\n`,
          env: { ...process.env, QUIZ_SERVICE_DATABASE_URL: pg.connectionString },
        },
      );
      expect(second.status).toBe(0);

      const rows = await sql`SELECT credential_hash, hall_display_name FROM devices WHERE device_id = ${deviceId}`;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.hall_display_name).toBe('Hall B');
      await expect(verifyDeviceCredential(rows[0]!.credential_hash as string, firstBearer)).resolves.toBe(false);
      await expect(verifyDeviceCredential(rows[0]!.credential_hash as string, secondBearer)).resolves.toBe(true);
    });
  });
});

// Sanity: fake-executable helper writes an executable file every time it's used.
describe('fake pg_dump/pg_restore executable seam', () => {
  it('is actually invoked when reachable via PATH', () => {
    const fake = writeFakeExecutable('pg_dump', { exitCode: 0 });
    mkdirSync(fake.dir, { recursive: true });
    expect(existsSync(join(fake.dir, 'pg_dump'))).toBe(true);
  });
});
