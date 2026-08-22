import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { zCreateUserResponse, zListUsersResponse, zProblem, zUpdateUserResponse } from '@eduscope/shared';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { users } from '../../src/db/schema.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { FakeClock } from '../fakes/clock.js';
import { InMemoryHelperTransport } from '../fakes/helper-server.js';
import { FakePipelineManager } from '../fakes/pipeline-manager.js';

const NOW = new Date('2026-08-19T00:00:00.000Z');
const BEARER = 'users-contract-pm-bearer';

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
  const dir = mkdtempSync(join(tmpdir(), 'core-api-users-contract-'));
  const pm = new FakePipelineManager({ bearerToken: BEARER });
  const pmBaseUrl = await pm.listen();

  const provisioningPath = join(dir, 'provisioning.json');
  writeFileSync(provisioningPath, JSON.stringify({ deviceId: 'device-1', hallCode: 'LAC001', hallDisplayName: 'Lecture Hall 1', titlePattern: '{hall} – {date} {time}' }));

  const config = loadConfig({
    NODE_ENV: 'test',
    CORE_API_DB_PATH: join(dir, 'core.db'),
    CORE_API_JWT_SECRET: 'users-contract-secret',
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

describe('users contract (openapi.yaml tag: users)', () => {
  let testApp: TestApp;
  afterEach(async () => stopTestApp(testApp));

  it('listUsers: 200 parses zListUsersResponse, 403 parses zProblem', async () => {
    testApp = await startTestApp();

    const ok = await testApp.app.inject({ method: 'GET', url: '/api/v1/users', headers: auth(testApp.adminToken) });
    expect(ok.statusCode).toBe(200);
    expect(() => zListUsersResponse.parse(ok.json())).not.toThrow();

    const forbidden = await testApp.app.inject({ method: 'GET', url: '/api/v1/users', headers: auth(testApp.lecturerToken) });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.headers['content-type']).toContain('application/problem+json');
    expect(() => zProblem.parse(forbidden.json())).not.toThrow();
  });

  it('createUser: 201 parses zCreateUserResponse, 409 parses zProblem, 422 parses zProblem', async () => {
    testApp = await startTestApp();

    const created = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: auth(testApp.adminToken),
      payload: { username: 'newlecturer', displayName: 'New Lecturer', role: 'lecturer', password: 'Password1' },
    });
    expect(created.statusCode).toBe(201);
    expect(() => zCreateUserResponse.parse(created.json())).not.toThrow();

    const duplicate = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: auth(testApp.adminToken),
      payload: { username: 'newlecturer', displayName: 'Duplicate', role: 'lecturer', password: 'Password1' },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(() => zProblem.parse(duplicate.json())).not.toThrow();

    const invalid = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: auth(testApp.adminToken),
      payload: { username: 'short', displayName: 'Short Password', role: 'lecturer', password: 'x' },
    });
    expect(invalid.statusCode).toBe(422);
    expect(() => zProblem.parse(invalid.json())).not.toThrow();
  });

  it('updateUser: 200 parses zUpdateUserResponse, 404 parses zProblem, 409 parses zProblem for self-disable', async () => {
    testApp = await startTestApp();

    const ok = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${testApp.adminId}`,
      headers: auth(testApp.adminToken),
      payload: { displayName: 'Renamed Admin' },
    });
    expect(ok.statusCode).toBe(200);
    expect(() => zUpdateUserResponse.parse(ok.json())).not.toThrow();

    const missing = await testApp.app.inject({
      method: 'PATCH',
      url: '/api/v1/users/01ARZ3NDEKTSV4RRFFQ69G5FAV',
      headers: auth(testApp.adminToken),
      payload: { displayName: 'Nobody' },
    });
    expect(missing.statusCode).toBe(404);
    expect(() => zProblem.parse(missing.json())).not.toThrow();

    const selfDisable = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${testApp.adminId}`,
      headers: auth(testApp.adminToken),
      payload: { disabled: true },
    });
    expect(selfDisable.statusCode).toBe(409);
    expect(() => zProblem.parse(selfDisable.json())).not.toThrow();
  });

  it('deleteUser: 204 empty body, 404 parses zProblem for an unknown user', async () => {
    testApp = await startTestApp();

    const created = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: auth(testApp.adminToken),
      payload: { username: 'todelete', displayName: 'To Delete', role: 'lecturer', password: 'Password1' },
    });
    const createdId = (created.json() as { id: string }).id;

    const deleted = await testApp.app.inject({ method: 'DELETE', url: `/api/v1/users/${createdId}`, headers: auth(testApp.adminToken) });
    expect(deleted.statusCode).toBe(204);
    expect(deleted.body).toBe('');

    const missing = await testApp.app.inject({ method: 'DELETE', url: '/api/v1/users/01ARZ3NDEKTSV4RRFFQ69G5FAV', headers: auth(testApp.adminToken) });
    expect(missing.statusCode).toBe(404);
    expect(() => zProblem.parse(missing.json())).not.toThrow();
  });
});
