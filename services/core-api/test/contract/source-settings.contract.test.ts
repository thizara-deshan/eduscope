import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import {
  zListPhysicalInputsResponse,
  zListSourceBindingsResponse,
  zListSourceRolesResponse,
  zProblem,
  zUpdatePhysicalInputResponse,
  zUpdateSourceBindingResponse,
} from '@eduscope/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { physicalInputs, users } from '../../src/db/schema.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { FakeClock } from '../fakes/clock.js';
import { FakePipelineManager } from '../fakes/pipeline-manager.js';

const NOW = new Date('2026-06-04T00:00:00.000Z');
const BEARER = 'contract-test-pm-bearer-sources-settings';

interface TestApp {
  app: FastifyInstance;
  dir: string;
  pm: FakePipelineManager;
  token: string;
}

async function startTestApp(): Promise<TestApp> {
  const dir = mkdtempSync(join(tmpdir(), 'core-api-source-settings-contract-'));
  const pm = new FakePipelineManager({ bearerToken: BEARER });
  const pmBaseUrl = await pm.listen();

  const config = loadConfig({
    NODE_ENV: 'test',
    CORE_API_DB_PATH: join(dir, 'core.db'),
    CORE_API_JWT_SECRET: 'source-settings-contract-secret',
    CORE_API_PM_BASE_URL: pmBaseUrl,
    CORE_API_INTERNAL_BEARER: BEARER,
  });
  const ids = new UlidGenerator();
  const app = await buildApp({ config, clock: new FakeClock(NOW), ids });
  await app.lifecycle.start();

  await app.db
    .insert(users)
    .values({
      id: ids.next(NOW),
      username: 'admin1',
      displayName: 'Admin One',
      role: 'admin',
      source: 'local',
      passwordHash: await hashPassword('Password1'),
      mustResetPassword: false,
      disabled: false,
      createdAt: NOW.toISOString(),
    })
    .run();

  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'admin1', password: 'Password1', client: 'panel' } });
  const token = (login.json() as { tokens: { accessToken: string } }).tokens.accessToken;

  return { app, dir, pm, token };
}

async function stopTestApp(testApp: TestApp): Promise<void> {
  await testApp.app.close();
  await testApp.pm.close();
  rmSync(testApp.dir, { recursive: true, force: true });
}

describe('source settings contract (openapi.yaml tag: sources — listSourceRoles, listPhysicalInputs, updatePhysicalInput, listSourceBindings, updateSourceBinding)', () => {
  let testApp: TestApp;

  afterEach(async () => {
    await stopTestApp(testApp);
  });

  it('listSourceRoles: 200 parses zListSourceRolesResponse', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({ method: 'GET', url: '/api/v1/sources/roles', headers: { authorization: `Bearer ${testApp.token}` } });
    expect(response.statusCode).toBe(200);
    expect(() => zListSourceRolesResponse.parse(response.json())).not.toThrow();
  });

  it('listPhysicalInputs: 200 parses zListPhysicalInputsResponse', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({ method: 'GET', url: '/api/v1/sources/inputs', headers: { authorization: `Bearer ${testApp.token}` } });
    expect(response.statusCode).toBe(200);
    expect(() => zListPhysicalInputsResponse.parse(response.json())).not.toThrow();
  });

  it('updatePhysicalInput: 200 parses zUpdatePhysicalInputResponse', async () => {
    testApp = await startTestApp();
    const input = testApp.app.db.select().from(physicalInputs).all()[0]!;
    const response = await testApp.app.inject({
      method: 'PUT',
      url: `/api/v1/sources/inputs/${input.id}`,
      headers: { authorization: `Bearer ${testApp.token}` },
      payload: { address: 'rtsp://10.0.0.5/stream1' },
    });
    expect(response.statusCode).toBe(200);
    expect(() => zUpdatePhysicalInputResponse.parse(response.json())).not.toThrow();
  });

  it('listSourceBindings: 200 parses zListSourceBindingsResponse', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({ method: 'GET', url: '/api/v1/sources/bindings', headers: { authorization: `Bearer ${testApp.token}` } });
    expect(response.statusCode).toBe(200);
    expect(() => zListSourceBindingsResponse.parse(response.json())).not.toThrow();
  });

  it('updateSourceBinding: 200 parses zUpdateSourceBindingResponse', async () => {
    testApp = await startTestApp();
    const input = testApp.app.db.select().from(physicalInputs).where(eq(physicalInputs.kind, 'v4l2')).get()!;
    await testApp.app.inject({
      method: 'PUT',
      url: '/api/v1/sources/bindings/presentation',
      headers: { authorization: `Bearer ${testApp.token}` },
      payload: { physicalInputId: null, enabled: false },
    });
    const response = await testApp.app.inject({
      method: 'PUT',
      url: '/api/v1/sources/bindings/presentation',
      headers: { authorization: `Bearer ${testApp.token}` },
      payload: { physicalInputId: input.id, enabled: true },
    });
    expect(response.statusCode).toBe(200);
    expect(() => zUpdateSourceBindingResponse.parse(response.json())).not.toThrow();
  });

  it('updateSourceBinding: 422 parses zProblem for mic-room', async () => {
    testApp = await startTestApp();
    const input = testApp.app.db.select().from(physicalInputs).where(eq(physicalInputs.kind, 'alsa')).get()!;
    const response = await testApp.app.inject({
      method: 'PUT',
      url: '/api/v1/sources/bindings/mic-room',
      headers: { authorization: `Bearer ${testApp.token}` },
      payload: { physicalInputId: input.id, enabled: true },
    });
    expect(response.statusCode).toBe(422);
    const problem = zProblem.parse(response.json());
    expect(problem.code).toBe('config.invalid');
  });

  it('updateSourceBinding: 409 parses zProblem for a physical input already bound to another role', async () => {
    testApp = await startTestApp();
    const input = testApp.app.db.select().from(physicalInputs).where(eq(physicalInputs.kind, 'rtsp')).get()!;
    const response = await testApp.app.inject({
      method: 'PUT',
      url: '/api/v1/sources/bindings/students-cam',
      headers: { authorization: `Bearer ${testApp.token}` },
      payload: { physicalInputId: input.id, enabled: true },
    });
    expect(response.statusCode).toBe(409);
    const problem = zProblem.parse(response.json());
    expect(problem.code).toBe('conflict');
  });
});
