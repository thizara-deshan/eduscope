import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { zImportUsersResponse, zProblem } from '@eduscope/shared';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { users } from '../../src/db/schema.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { FakeClock } from '../fakes/clock.js';
import { InMemoryHelperTransport } from '../fakes/helper-server.js';
import { FakePipelineManager } from '../fakes/pipeline-manager.js';

const NOW = new Date('2026-08-19T00:00:00.000Z');
const BEARER = 'users-import-contract-pm-bearer';
const BOUNDARY = '----eduscope-contract-boundary';
const FIXTURES_DIR = join(import.meta.dirname, '../fixtures/users');

interface TestApp {
  app: FastifyInstance;
  dir: string;
  pm: FakePipelineManager;
  adminToken: string;
  lecturerToken: string;
}

async function loginAs(app: FastifyInstance, username: string, password: string): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password, client: 'panel' } });
  return (response.json() as { tokens: { accessToken: string } }).tokens.accessToken;
}

async function startTestApp(): Promise<TestApp> {
  const dir = mkdtempSync(join(tmpdir(), 'core-api-users-import-contract-'));
  const pm = new FakePipelineManager({ bearerToken: BEARER });
  const pmBaseUrl = await pm.listen();

  const provisioningPath = join(dir, 'provisioning.json');
  writeFileSync(provisioningPath, JSON.stringify({ deviceId: 'device-1', hallCode: 'LAC001', hallDisplayName: 'Lecture Hall 1', titlePattern: '{hall} – {date} {time}' }));

  const config = loadConfig({
    NODE_ENV: 'test',
    CORE_API_DB_PATH: join(dir, 'core.db'),
    CORE_API_JWT_SECRET: 'users-import-contract-secret',
    CORE_API_PROVISIONING_PATH: provisioningPath,
    CORE_API_RECORDINGS_ROOT: join(dir, 'recordings'),
    CORE_API_PM_BASE_URL: pmBaseUrl,
    CORE_API_INTERNAL_BEARER: BEARER,
  });

  const ids = new UlidGenerator();
  const transport = new InMemoryHelperTransport();
  const app = await buildApp({ config, clock: new FakeClock(NOW), ids, helperTransport: transport });
  await app.lifecycle.start();

  await app.db
    .insert(users)
    .values([
      { id: ids.next(NOW), username: 'admin1', displayName: 'Admin One', role: 'admin', source: 'local', passwordHash: await hashPassword('Password1'), mustResetPassword: false, disabled: false, createdAt: NOW.toISOString() },
      { id: ids.next(NOW), username: 'lecturer1', displayName: 'Lecturer One', role: 'lecturer', source: 'local', passwordHash: await hashPassword('Password1'), mustResetPassword: false, disabled: false, createdAt: NOW.toISOString() },
    ])
    .run();
  const adminToken = await loginAs(app, 'admin1', 'Password1');
  const lecturerToken = await loginAs(app, 'lecturer1', 'Password1');

  return { app, dir, pm, adminToken, lecturerToken };
}

async function stopTestApp(testApp: TestApp): Promise<void> {
  await testApp.app.close();
  await testApp.pm.close();
  rmSync(testApp.dir, { recursive: true, force: true });
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

describe('user import contract (openapi.yaml importUsers, tag: users)', () => {
  let testApp: TestApp;
  afterEach(async () => stopTestApp(testApp));

  it('201 parses zImportUsersResponse for an accepted batch', async () => {
    testApp = await startTestApp();
    const { body, contentType } = multipartXlsxBody('valid.xlsx');

    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/users/import',
      headers: { authorization: `Bearer ${testApp.adminToken}`, 'content-type': contentType },
      payload: body,
    });

    expect(response.statusCode).toBe(201);
    expect(() => zImportUsersResponse.parse(response.json())).not.toThrow();
  });

  it('422 parses zImportUsersResponse for a rejected batch, carrying row-level rejections', async () => {
    testApp = await startTestApp();
    const { body, contentType } = multipartXlsxBody('invalid-null.xlsx');

    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/users/import',
      headers: { authorization: `Bearer ${testApp.adminToken}`, 'content-type': contentType },
      payload: body,
    });

    expect(response.statusCode).toBe(422);
    const parsed = zImportUsersResponse.parse(response.json());
    expect(parsed.state).toBe('rejected');
    expect(parsed.rejections.length).toBeGreaterThan(0);
  });

  it('403 parses zProblem for a non-admin caller, 401 without a bearer token', async () => {
    testApp = await startTestApp();
    const { body, contentType } = multipartXlsxBody('valid.xlsx');

    const forbidden = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/users/import',
      headers: { authorization: `Bearer ${testApp.lecturerToken}`, 'content-type': contentType },
      payload: body,
    });
    expect(forbidden.statusCode).toBe(403);
    expect(() => zProblem.parse(forbidden.json())).not.toThrow();

    const { body: body2, contentType: contentType2 } = multipartXlsxBody('valid.xlsx');
    const unauthed = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/users/import',
      headers: { 'content-type': contentType2 },
      payload: body2,
    });
    expect(unauthed.statusCode).toBe(401);
    expect(() => zProblem.parse(unauthed.json())).not.toThrow();
  });
});
