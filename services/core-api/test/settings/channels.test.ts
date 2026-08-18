import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { LAYOUT_PRESETS } from '@eduscope/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { layoutPresets, sourceBindings, users } from '../../src/db/schema.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { FakeClock } from '../fakes/clock.js';

const NOW = new Date('2026-06-01T00:00:00.000Z');

interface TestApp {
  app: FastifyInstance;
  dir: string;
  lecturerToken: string;
  adminToken: string;
}

async function loginAs(app: FastifyInstance, username: string, password: string): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password, client: 'panel' } });
  return (response.json() as { tokens: { accessToken: string } }).tokens.accessToken;
}

async function startTestApp(): Promise<TestApp> {
  const dir = mkdtempSync(join(tmpdir(), 'core-api-settings-channels-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    CORE_API_DB_PATH: join(dir, 'core.db'),
    CORE_API_JWT_SECRET: 'settings-channels-test-secret',
  });
  const ids = new UlidGenerator();
  const app = await buildApp({ config, clock: new FakeClock(NOW), ids });
  await app.lifecycle.start();

  await app.db
    .insert(users)
    .values([
      {
        id: ids.next(NOW),
        username: 'lecturer1',
        displayName: 'Lecturer One',
        role: 'lecturer',
        source: 'local',
        passwordHash: await hashPassword('Password1'),
        mustResetPassword: false,
        disabled: false,
        createdAt: NOW.toISOString(),
      },
      {
        id: ids.next(NOW),
        username: 'admin1',
        displayName: 'Admin One',
        role: 'admin',
        source: 'local',
        passwordHash: await hashPassword('Password1'),
        mustResetPassword: false,
        disabled: false,
        createdAt: NOW.toISOString(),
      },
    ])
    .run();

  const lecturerToken = await loginAs(app, 'lecturer1', 'Password1');
  const adminToken = await loginAs(app, 'admin1', 'Password1');

  return { app, dir, lecturerToken, adminToken };
}

async function stopTestApp(testApp: TestApp): Promise<void> {
  await testApp.app.close();
  rmSync(testApp.dir, { recursive: true, force: true });
}

describe('channel/layout settings (openapi.yaml tag: channels — listChannels, updateChannelConfig, listLayoutPresets)', () => {
  let testApp: TestApp;

  afterEach(async () => {
    await stopTestApp(testApp);
  });

  it('listChannels: returns exactly local/meeting/streaming with config+status', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({
      method: 'GET',
      url: '/api/v1/channels',
      headers: { authorization: `Bearer ${testApp.lecturerToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      items: Array<{ config: { channelId: string; alwaysOn: boolean }; status: { channelId: string; state: string } }>;
    };
    expect(body.items.map((item) => item.config.channelId).sort()).toEqual(['local', 'meeting', 'streaming']);
    const local = body.items.find((item) => item.config.channelId === 'local')!;
    expect(local.config.alwaysOn).toBe(true);
    expect(local.status.state).toBe('off');
  });

  it('listLayoutPresets: matches the shared catalog field-for-field (freshness)', async () => {
    testApp = await startTestApp();
    const dbRows = testApp.app.db.select().from(layoutPresets).all();
    const byId = new Map(dbRows.map((row) => [row.id, row]));

    for (const preset of LAYOUT_PRESETS) {
      const row = byId.get(preset.id);
      expect(row, `seeded row for ${preset.id}`).toBeDefined();
      expect(row!.displayName).toBe(preset.displayName);
      expect(row!.description).toBe(preset.description);
      expect(row!.allowedChannels).toEqual(preset.allowedChannels);
      expect(row!.kind).toBe(preset.kind);
      expect(row!.canvas).toEqual(preset.canvas);
      expect(row!.tiles).toEqual(preset.tiles);
      expect(row!.parametric).toBe(preset.parametric);
      expect(row!.outputs).toEqual(preset.outputs);
      expect(row!.passthroughEligible).toBe(preset.passthroughEligible);
      expect(row!.requiredRoles).toEqual(preset.requiredRoles);
    }

    const response = await testApp.app.inject({
      method: 'GET',
      url: '/api/v1/layouts',
      headers: { authorization: `Bearer ${testApp.lecturerToken}` },
    });
    expect(response.statusCode).toBe(200);
    expect((response.json() as { items: unknown[] }).items).toHaveLength(LAYOUT_PRESETS.length);
  });

  it('updateChannelConfig: local rejects meeting-only preset "cams-fifty-fifty" (allowed-channel matrix, INV-LP-1)', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({
      method: 'PUT',
      url: '/api/v1/channels/local',
      headers: { authorization: `Bearer ${testApp.adminToken}` },
      payload: { presetId: 'cams-fifty-fifty' },
    });
    expect(response.statusCode).toBe(422);
    expect((response.json() as { code: string }).code).toBe('config.invalid');
  });

  it('updateChannelConfig: meeting rejects "pc-only" (allowed-channel matrix)', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({
      method: 'PUT',
      url: '/api/v1/channels/meeting',
      headers: { authorization: `Bearer ${testApp.adminToken}` },
      payload: { presetId: 'pc-only' },
    });
    expect(response.statusCode).toBe(422);
    expect((response.json() as { code: string }).code).toBe('config.invalid');
  });

  it('updateChannelConfig: local always-on cannot be disabled (INV-CC-1)', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({
      method: 'PUT',
      url: '/api/v1/channels/local',
      headers: { authorization: `Bearer ${testApp.adminToken}` },
      payload: { enabledByDefault: false },
    });
    expect(response.statusCode).toBe(422);
    expect((response.json() as { code: string }).code).toBe('config.invalid');
  });

  it('updateChannelConfig: parametric preset requires positive ratioA/ratioB', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({
      method: 'PUT',
      url: '/api/v1/channels/local',
      headers: { authorization: `Bearer ${testApp.adminToken}` },
      payload: { presetId: 'fifty-fifty', ratioA: 0, ratioB: 50 },
    });
    expect(response.statusCode).toBe(422);
    expect((response.json() as { code: string }).code).toBe('config.invalid');
  });

  it('updateChannelConfig: required role must be bound and enabled', async () => {
    testApp = await startTestApp();
    testApp.app.db.delete(sourceBindings).run();

    const response = await testApp.app.inject({
      method: 'PUT',
      url: '/api/v1/channels/local',
      headers: { authorization: `Bearer ${testApp.adminToken}` },
      payload: { presetId: 'cam-1' },
    });
    expect(response.statusCode).toBe(422);
    expect((response.json() as { code: string }).code).toBe('config.invalid');
  });

  it('updateChannelConfig: streamTargetIds only apply to the streaming channel', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({
      method: 'PUT',
      url: '/api/v1/channels/local',
      headers: { authorization: `Bearer ${testApp.adminToken}` },
      payload: { streamTargetIds: ['01ARZ3NDEKTSV4RRFFQ69G5FAV'] },
    });
    expect(response.statusCode).toBe(422);
    expect((response.json() as { code: string }).code).toBe('config.invalid');
  });

  it('updateChannelConfig: streamTargetIds requires admin', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({
      method: 'PUT',
      url: '/api/v1/channels/streaming',
      headers: { authorization: `Bearer ${testApp.lecturerToken}` },
      payload: { streamTargetIds: [] },
    });
    expect(response.statusCode).toBe(422);
    expect((response.json() as { code: string }).code).toBe('config.invalid');
  });

  it('updateChannelConfig: lecturer can edit the streaming layout preset', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({
      method: 'PUT',
      url: '/api/v1/channels/streaming',
      headers: { authorization: `Bearer ${testApp.lecturerToken}` },
      payload: { presetId: 'cam-1' },
    });
    expect(response.statusCode).toBe(200);
    expect((response.json() as { presetId: string }).presetId).toBe('cam-1');
  });

  it('updateChannelConfig: valid update persists and is reflected by listChannels', async () => {
    testApp = await startTestApp();
    const put = await testApp.app.inject({
      method: 'PUT',
      url: '/api/v1/channels/local',
      headers: { authorization: `Bearer ${testApp.adminToken}` },
      payload: { presetId: 'side-by-side' },
    });
    expect(put.statusCode).toBe(200);
    expect((put.json() as { presetId: string }).presetId).toBe('side-by-side');

    const list = await testApp.app.inject({
      method: 'GET',
      url: '/api/v1/channels',
      headers: { authorization: `Bearer ${testApp.adminToken}` },
    });
    const items = (list.json() as { items: Array<{ config: { channelId: string; presetId: string } }> }).items;
    expect(items.find((item) => item.config.channelId === 'local')!.config.presetId).toBe('side-by-side');
  });
});
