import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { zLoginResponse, zProblem, zRefreshResponse, zUser } from '@eduscope/shared';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { users } from '../../src/db/schema.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { FakeClock } from '../fakes/clock.js';

const NOW = new Date('2026-01-01T00:00:00.000Z');

interface TestApp {
  app: FastifyInstance;
  dir: string;
}

async function startTestApp(): Promise<TestApp> {
  const dir = mkdtempSync(join(tmpdir(), 'core-api-auth-contract-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    CORE_API_DB_PATH: join(dir, 'core.db'),
    CORE_API_JWT_SECRET: 'contract-test-jwt-secret',
  });
  const app = await buildApp({ config, clock: new FakeClock(NOW), ids: new UlidGenerator() });
  await app.lifecycle.start();
  return { app, dir };
}

async function stopTestApp(testApp: TestApp): Promise<void> {
  await testApp.app.close();
  rmSync(testApp.dir, { recursive: true, force: true });
}

describe('auth contract (openapi.yaml tag: auth)', () => {
  let testApp: TestApp;

  beforeEach(async () => {
    testApp = await startTestApp();
    testApp.app.db
      .insert(users)
      .values({
        id: new UlidGenerator().next(NOW),
        username: 'lecturer1',
        displayName: 'Lecturer One',
        role: 'lecturer',
        source: 'local',
        passwordHash: await hashPassword('Password1'),
        mustResetPassword: false,
        disabled: false,
        createdAt: NOW.toISOString(),
      })
      .run();
  });

  afterEach(async () => {
    await stopTestApp(testApp);
  });

  async function login(): Promise<{ accessToken: string; refreshToken: string }> {
    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'lecturer1', password: 'Password1', client: 'panel' },
    });
    const body = zLoginResponse.parse(response.json());
    return { accessToken: body.tokens.accessToken, refreshToken: body.tokens.refreshToken };
  }

  it('login: 200 parses zLoginResponse', async () => {
    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'lecturer1', password: 'Password1', client: 'panel' },
    });

    expect(response.statusCode).toBe(200);
    expect(() => zLoginResponse.parse(response.json())).not.toThrow();
  });

  it('login: 401 auth.invalid-credentials parses zProblem', async () => {
    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'lecturer1', password: 'wrong', client: 'panel' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.headers['content-type']).toContain('application/problem+json');
    const body = zProblem.parse(response.json());
    expect(body.code).toBe('auth.invalid-credentials');
  });

  it('refresh: 200 parses zRefreshResponse and rotates the token', async () => {
    const { refreshToken } = await login();

    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken },
    });

    expect(response.statusCode).toBe(200);
    const body = zRefreshResponse.parse(response.json());
    expect(body.tokens.refreshToken).not.toBe(refreshToken);
  });

  it('refresh: 401 parses zProblem for an unrecognized token', async () => {
    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: 'not-a-real-token' },
    });

    expect(response.statusCode).toBe(401);
    expect(() => zProblem.parse(response.json())).not.toThrow();
  });

  it('logout: 204 with a valid bearer token, 401 without one', async () => {
    const { accessToken } = await login();

    const authed = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(authed.statusCode).toBe(204);
    expect(authed.body).toBe('');

    const unauthed = await testApp.app.inject({ method: 'POST', url: '/api/v1/auth/logout' });
    expect(unauthed.statusCode).toBe(401);
    expect(() => zProblem.parse(unauthed.json())).not.toThrow();
  });

  it('getMe: 200 parses zUser and never carries a password hash', async () => {
    const { accessToken } = await login();

    const response = await testApp.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as Record<string, unknown>;
    expect(() => zUser.parse(body)).not.toThrow();
    expect(body).not.toHaveProperty('passwordHash');
  });

  it('changePassword: 204 on success, 401 on wrong current password, 422 on weak composition', async () => {
    const { accessToken } = await login();

    const weak = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { currentPassword: 'Password1', newPassword: 'short' },
    });
    expect(weak.statusCode).toBe(422);
    const weakBody = zProblem.parse(weak.json());
    expect(weakBody.code).toBe('validation.invalid');

    const wrongCurrent = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { currentPassword: 'wrong', newPassword: 'NewPassw0rd' },
    });
    expect(wrongCurrent.statusCode).toBe(401);
    expect(zProblem.parse(wrongCurrent.json()).code).toBe('auth.invalid-credentials');

    const success = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { currentPassword: 'Password1', newPassword: 'NewPassw0rd' },
    });
    expect(success.statusCode).toBe(204);
  });
});
