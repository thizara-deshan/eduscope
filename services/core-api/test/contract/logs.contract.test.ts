import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { zExportLogsCsvResponse, zProblem, zQueryLogsResponse } from '@eduscope/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { users } from '../../src/db/schema.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { FakeClock } from '../fakes/clock.js';

const NOW = new Date('2026-08-21T00:00:00.000Z');

interface TestApp {
  app: FastifyInstance;
  dir: string;
  adminToken: string;
  lecturerToken: string;
}

async function startTestApp(): Promise<TestApp> {
  const dir = mkdtempSync(join(tmpdir(), 'core-api-logs-contract-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    CORE_API_DB_PATH: join(dir, 'core.db'),
    CORE_API_JWT_SECRET: 'logs-contract-secret',
    CORE_API_RECORDINGS_ROOT: join(dir, 'recordings'),
  });
  const ids = new UlidGenerator();
  const app = await buildApp({ config, clock: new FakeClock(NOW), ids });
  await app.lifecycle.start();

  await app.db
    .insert(users)
    .values([
      { id: ids.next(NOW), username: 'admin1', displayName: 'Admin One', role: 'admin', source: 'local', passwordHash: await hashPassword('Password1'), mustResetPassword: false, disabled: false, createdAt: NOW.toISOString() },
      { id: ids.next(NOW), username: 'lecturer1', displayName: 'Lecturer One', role: 'lecturer', source: 'local', passwordHash: await hashPassword('Password1'), mustResetPassword: false, disabled: false, createdAt: NOW.toISOString() },
    ])
    .run();

  app.logStore.write({ level: 'INFO', category: 'System', service: 'core-api', message: 'contract fixture entry' });

  const adminLogin = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'admin1', password: 'Password1', client: 'panel' } });
  const adminToken = (adminLogin.json() as { tokens: { accessToken: string } }).tokens.accessToken;
  const lecturerLogin = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'lecturer1', password: 'Password1', client: 'panel' } });
  const lecturerToken = (lecturerLogin.json() as { tokens: { accessToken: string } }).tokens.accessToken;

  return { app, dir, adminToken, lecturerToken };
}

async function stopTestApp(testApp: TestApp): Promise<void> {
  await testApp.app.close();
  rmSync(testApp.dir, { recursive: true, force: true });
}

describe('observability contract (openapi.yaml tag: logs — queryLogs, exportLogsCsv)', () => {
  let testApp: TestApp;

  afterEach(async () => {
    await stopTestApp(testApp);
  });

  it('queryLogs: 200 parses zQueryLogsResponse', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({ method: 'GET', url: '/api/v1/logs', headers: { authorization: `Bearer ${testApp.adminToken}` } });
    expect(response.statusCode).toBe(200);
    expect(() => zQueryLogsResponse.parse(response.json())).not.toThrow();
  });

  it('queryLogs: 403 parses zProblem for a non-admin', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({ method: 'GET', url: '/api/v1/logs', headers: { authorization: `Bearer ${testApp.lecturerToken}` } });
    expect(response.statusCode).toBe(403);
    expect(() => zProblem.parse(response.json())).not.toThrow();
  });

  it('exportLogsCsv: 200 parses zExportLogsCsvResponse', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({ method: 'GET', url: '/api/v1/logs/export', headers: { authorization: `Bearer ${testApp.adminToken}` } });
    expect(response.statusCode).toBe(200);
    expect(() => zExportLogsCsvResponse.parse(response.body)).not.toThrow();
  });

  it('exportLogsCsv: 403 parses zProblem for a non-admin', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({ method: 'GET', url: '/api/v1/logs/export', headers: { authorization: `Bearer ${testApp.lecturerToken}` } });
    expect(response.statusCode).toBe(403);
    expect(() => zProblem.parse(response.json())).not.toThrow();
  });
});
