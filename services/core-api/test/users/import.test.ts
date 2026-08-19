import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import type { UserImportBatch } from '@eduscope/shared';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { users } from '../../src/db/schema.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { FakeClock } from '../fakes/clock.js';
import { InMemoryHelperTransport } from '../fakes/helper-server.js';
import { FakePipelineManager } from '../fakes/pipeline-manager.js';

const NOW = new Date('2026-08-19T00:00:00.000Z');
const BEARER = 'users-import-pm-bearer';
const BOUNDARY = '----eduscope-test-boundary';
const FIXTURES_DIR = join(import.meta.dirname, '../fixtures/users');

interface TestApp {
  app: FastifyInstance;
  dir: string;
  pm: FakePipelineManager;
  adminId: string;
  adminToken: string;
  lecturerToken: string;
}

async function loginAs(app: FastifyInstance, username: string, password: string): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password, client: 'panel' } });
  return (response.json() as { tokens: { accessToken: string } }).tokens.accessToken;
}

async function startTestApp(): Promise<TestApp> {
  const dir = mkdtempSync(join(tmpdir(), 'core-api-users-import-'));
  const pm = new FakePipelineManager({ bearerToken: BEARER });
  const pmBaseUrl = await pm.listen();

  const provisioningPath = join(dir, 'provisioning.json');
  writeFileSync(provisioningPath, JSON.stringify({ deviceId: 'device-1', hallCode: 'LAC001', hallDisplayName: 'Lecture Hall 1', titlePattern: '{hall} – {date} {time}' }));

  const config = loadConfig({
    NODE_ENV: 'test',
    CORE_API_DB_PATH: join(dir, 'core.db'),
    CORE_API_JWT_SECRET: 'users-import-secret',
    CORE_API_PROVISIONING_PATH: provisioningPath,
    CORE_API_RECORDINGS_ROOT: join(dir, 'recordings'),
    CORE_API_PM_BASE_URL: pmBaseUrl,
    CORE_API_INTERNAL_BEARER: BEARER,
  });

  const ids = new UlidGenerator();
  const transport = new InMemoryHelperTransport();
  const app = await buildApp({ config, clock: new FakeClock(NOW), ids, helperTransport: transport });
  await app.lifecycle.start();

  const adminId = ids.next(NOW);
  const lecturerId = ids.next(NOW);
  await app.db
    .insert(users)
    .values([
      { id: adminId, username: 'admin1', displayName: 'Admin One', role: 'admin', source: 'local', passwordHash: await hashPassword('Password1'), mustResetPassword: false, disabled: false, createdAt: NOW.toISOString() },
      { id: lecturerId, username: 'lecturer1', displayName: 'Lecturer One', role: 'lecturer', source: 'local', passwordHash: await hashPassword('Password1'), mustResetPassword: false, disabled: false, createdAt: NOW.toISOString() },
    ])
    .run();

  const adminToken = await loginAs(app, 'admin1', 'Password1');
  const lecturerToken = await loginAs(app, 'lecturer1', 'Password1');

  return { app, dir, pm, adminId, adminToken, lecturerToken };
}

async function stopTestApp(testApp: TestApp): Promise<void> {
  await testApp.app.close();
  await testApp.pm.close();
  rmSync(testApp.dir, { recursive: true, force: true });
}

function auth(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

function multipartXlsxBody(fixtureFile: string): { body: Buffer; contentType: string } {
  const fileBuffer = readFileSync(join(FIXTURES_DIR, fixtureFile));
  const head = Buffer.from(
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${fixtureFile}"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`,
    'utf8',
  );
  const tail = Buffer.from(`\r\n--${BOUNDARY}--\r\n`, 'utf8');
  return { body: Buffer.concat([head, fileBuffer, tail]), contentType: `multipart/form-data; boundary=${BOUNDARY}` };
}

function textFieldBody(fieldName: string, value: string): { body: Buffer; contentType: string } {
  const body = Buffer.from(
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${fieldName}"\r\n\r\n${value}\r\n--${BOUNDARY}--\r\n`,
    'utf8',
  );
  return { body, contentType: `multipart/form-data; boundary=${BOUNDARY}` };
}

describe('users Excel import (openapi.yaml importUsers, AD-6/B-44 KEEP)', () => {
  let testApp: TestApp;
  afterEach(async () => stopTestApp(testApp));

  it('is admin-only and requires a file part', async () => {
    testApp = await startTestApp();

    const { body, contentType } = multipartXlsxBody('valid.xlsx');
    const forbidden = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/users/import',
      headers: { ...auth(testApp.lecturerToken), 'content-type': contentType },
      payload: body,
    });
    expect(forbidden.statusCode).toBe(403);

    const noFile = textFieldBody('notAFile', 'irrelevant');
    const missing = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/users/import',
      headers: { ...auth(testApp.adminToken), 'content-type': noFile.contentType },
      payload: noFile.body,
    });
    expect(missing.statusCode).toBe(422);
  });

  it('accepts a valid roster: all-or-nothing insert, forced reset, and import provenance', async () => {
    testApp = await startTestApp();
    const { body, contentType } = multipartXlsxBody('valid.xlsx');

    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/users/import',
      headers: { ...auth(testApp.adminToken), 'content-type': contentType },
      payload: body,
    });
    expect(response.statusCode).toBe(201);
    const batch = response.json() as UserImportBatch;
    expect(batch.state).toBe('applied');
    expect(batch.rowCount).toBe(3);
    expect(batch.acceptedCount).toBe(3);
    expect(batch.rejections).toEqual([]);

    const imported = testApp.app.db.select().from(users).where(eq(users.username, 'import.lecturer1')).get()!;
    expect(imported.mustResetPassword).toBe(true);
    expect(imported.importBatchId).toBe(batch.id);
    expect(imported).not.toHaveProperty('password');
    expect(imported.passwordHash).not.toBe('Password1');

    const institute = testApp.app.db.select().from(users).where(eq(users.username, 'import.admin1')).get()!;
    expect(institute.source).toBe('institute');
    expect(institute.externalId).toBe('EXT-001');
    expect(institute.role).toBe('admin');

    // The imported (local-source) user can log in but only reaches the reset allowlist.
    const login = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'import.lecturer1', password: 'Password1', client: 'panel' },
    });
    expect(login.statusCode).toBe(200);
    const loginBody = login.json() as { mustResetPassword: boolean; tokens: { accessToken: string } };
    expect(loginBody.mustResetPassword).toBe(true);

    const blocked = await testApp.app.inject({
      method: 'GET',
      url: '/api/v1/recording/state',
      headers: auth(loginBody.tokens.accessToken),
    });
    expect(blocked.statusCode).toBe(403);

    const allowed = await testApp.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(loginBody.tokens.accessToken) });
    expect(allowed.statusCode).toBe(200);
  });

  it('rejects a batch containing a null required cell, writing zero users', async () => {
    testApp = await startTestApp();
    const { body, contentType } = multipartXlsxBody('invalid-null.xlsx');

    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/users/import',
      headers: { ...auth(testApp.adminToken), 'content-type': contentType },
      payload: body,
    });
    expect(response.statusCode).toBe(422);
    const batch = response.json() as UserImportBatch;
    expect(batch.state).toBe('rejected');
    expect(batch.acceptedCount).toBe(0);
    expect(batch.rejections).toEqual([{ row: 3, column: 'displayName', reason: 'empty-cell' }]);

    expect(testApp.app.db.select().from(users).where(eq(users.username, 'import.lecturer1')).get()).toBeUndefined();
  });

  it('rejects a batch with an in-file duplicate username, writing zero users', async () => {
    testApp = await startTestApp();
    const { body, contentType } = multipartXlsxBody('duplicate.xlsx');

    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/users/import',
      headers: { ...auth(testApp.adminToken), 'content-type': contentType },
      payload: body,
    });
    expect(response.statusCode).toBe(422);
    const batch = response.json() as UserImportBatch;
    expect(batch.state).toBe('rejected');
    expect(batch.rejections).toEqual([{ row: 3, column: 'username', reason: 'duplicate-username-in-file' }]);

    expect(testApp.app.db.select().from(users).where(eq(users.username, 'import.lecturer1')).get()).toBeUndefined();
  });

  it('rejects a row whose username already exists', async () => {
    testApp = await startTestApp();
    const { body, contentType } = multipartXlsxBody('valid.xlsx');

    // Pre-seed a username collision with the fixture's first row.
    testApp.app.db
      .insert(users)
      .values({
        id: 'preexisting-user',
        username: 'import.lecturer1',
        displayName: 'Already Here',
        role: 'lecturer',
        source: 'local',
        passwordHash: null,
        mustResetPassword: false,
        disabled: false,
        createdAt: NOW.toISOString(),
      })
      .run();

    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/users/import',
      headers: { ...auth(testApp.adminToken), 'content-type': contentType },
      payload: body,
    });
    expect(response.statusCode).toBe(422);
    const batch = response.json() as UserImportBatch;
    expect(batch.rejections).toEqual([{ row: 2, column: 'username', reason: 'username-exists' }]);
  });
});
