import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { zListAudioControlsResponse, zProblem, zUpdateAudioControlResponse } from '@eduscope/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { users } from '../../src/db/schema.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { FakeClock } from '../fakes/clock.js';
import { FakePipelineManager } from '../fakes/pipeline-manager.js';

const NOW = new Date('2026-06-06T00:00:00.000Z');
const BEARER = 'contract-test-pm-bearer-audio';

interface TestApp {
  app: FastifyInstance;
  dir: string;
  pm: FakePipelineManager;
  token: string;
}

async function startTestApp(): Promise<TestApp> {
  const dir = mkdtempSync(join(tmpdir(), 'core-api-audio-contract-'));
  const pm = new FakePipelineManager({ bearerToken: BEARER });
  const pmBaseUrl = await pm.listen();

  const config = loadConfig({
    NODE_ENV: 'test',
    CORE_API_DB_PATH: join(dir, 'core.db'),
    CORE_API_JWT_SECRET: 'audio-contract-secret',
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

describe('audio controls contract (openapi.yaml tag: sources — listAudioControls, updateAudioControl)', () => {
  let testApp: TestApp;

  afterEach(async () => {
    await stopTestApp(testApp);
  });

  it('listAudioControls: 200 parses zListAudioControlsResponse', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({ method: 'GET', url: '/api/v1/audio/controls', headers: { authorization: `Bearer ${testApp.token}` } });
    expect(response.statusCode).toBe(200);
    expect(() => zListAudioControlsResponse.parse(response.json())).not.toThrow();
  });

  it('updateAudioControl: 202 parses zUpdateAudioControlResponse', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({
      method: 'PUT',
      url: '/api/v1/audio/controls/mic-lecturer',
      headers: { authorization: `Bearer ${testApp.token}` },
      payload: { gain: 50, muted: false },
    });
    expect(response.statusCode).toBe(202);
    expect(() => zUpdateAudioControlResponse.parse(response.json())).not.toThrow();
  });

  it('updateAudioControl: 422 parses zProblem for a non-mutable role', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({
      method: 'PUT',
      url: '/api/v1/audio/controls/presentation',
      headers: { authorization: `Bearer ${testApp.token}` },
      payload: { gain: 50 },
    });
    expect(response.statusCode).toBe(422);
    const problem = zProblem.parse(response.json());
    expect(problem.code).toBe('config.invalid');
  });
});
