import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { zListChannelsResponse, zListLayoutPresetsResponse, zProblem, zUpdateChannelConfigResponse } from '@eduscope/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { users } from '../../src/db/schema.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { FakeClock } from '../fakes/clock.js';

const NOW = new Date('2026-06-02T00:00:00.000Z');

interface TestApp {
  app: FastifyInstance;
  dir: string;
  token: string;
}

async function startTestApp(): Promise<TestApp> {
  const dir = mkdtempSync(join(tmpdir(), 'core-api-channel-settings-contract-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    CORE_API_DB_PATH: join(dir, 'core.db'),
    CORE_API_JWT_SECRET: 'channel-settings-contract-secret',
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

  return { app, dir, token };
}

async function stopTestApp(testApp: TestApp): Promise<void> {
  await testApp.app.close();
  rmSync(testApp.dir, { recursive: true, force: true });
}

describe('channel settings contract (openapi.yaml tag: channels — listChannels, updateChannelConfig, listLayoutPresets)', () => {
  let testApp: TestApp;

  afterEach(async () => {
    await stopTestApp(testApp);
  });

  it('listChannels: 200 parses zListChannelsResponse', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({ method: 'GET', url: '/api/v1/channels', headers: { authorization: `Bearer ${testApp.token}` } });
    expect(response.statusCode).toBe(200);
    expect(() => zListChannelsResponse.parse(response.json())).not.toThrow();
  });

  it('listLayoutPresets: 200 parses zListLayoutPresetsResponse', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({ method: 'GET', url: '/api/v1/layouts', headers: { authorization: `Bearer ${testApp.token}` } });
    expect(response.statusCode).toBe(200);
    expect(() => zListLayoutPresetsResponse.parse(response.json())).not.toThrow();
  });

  it('updateChannelConfig: 200 parses zUpdateChannelConfigResponse', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({
      method: 'PUT',
      url: '/api/v1/channels/streaming',
      headers: { authorization: `Bearer ${testApp.token}` },
      payload: { presetId: 'cam-1' },
    });
    expect(response.statusCode).toBe(200);
    expect(() => zUpdateChannelConfigResponse.parse(response.json())).not.toThrow();
  });

  it('updateChannelConfig: 422 parses zProblem for an invalid preset/channel combination', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({
      method: 'PUT',
      url: '/api/v1/channels/meeting',
      headers: { authorization: `Bearer ${testApp.token}` },
      payload: { presetId: 'pc-only' },
    });
    expect(response.statusCode).toBe(422);
    const problem = zProblem.parse(response.json());
    expect(problem.code).toBe('config.invalid');
  });
});
