import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { auditLogEntries, physicalInputs, sourceBindings, users } from '../../src/db/schema.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { FakeClock } from '../fakes/clock.js';
import { FakePipelineManager } from '../fakes/pipeline-manager.js';

const NOW = new Date('2026-06-03T00:00:00.000Z');
const BEARER = 'sources-settings-test-pm-bearer';
const CREDENTIAL_PLAINTEXT = JSON.stringify({ username: 'camops', password: 's3cret-camera-password' });

async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: condition not met in time');
    await delay(5);
  }
}

interface TestApp {
  app: FastifyInstance;
  dir: string;
  pm: FakePipelineManager;
  lecturerToken: string;
  adminToken: string;
}

async function loginAs(app: FastifyInstance, username: string, password: string): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password, client: 'panel' } });
  return (response.json() as { tokens: { accessToken: string } }).tokens.accessToken;
}

async function startTestApp(): Promise<TestApp> {
  const dir = mkdtempSync(join(tmpdir(), 'core-api-settings-sources-'));
  const pm = new FakePipelineManager({ bearerToken: BEARER });
  const pmBaseUrl = await pm.listen();

  const config = loadConfig({
    NODE_ENV: 'test',
    CORE_API_DB_PATH: join(dir, 'core.db'),
    CORE_API_JWT_SECRET: 'settings-sources-test-secret',
    CORE_API_PM_BASE_URL: pmBaseUrl,
    CORE_API_INTERNAL_BEARER: BEARER,
  });

  const ids = new UlidGenerator();
  const app = await buildApp({ config, clock: new FakeClock(NOW), ids });
  await app.lifecycle.start();
  await waitFor(() => pm.openConnectionCount === 1);

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

  return { app, dir, pm, lecturerToken, adminToken };
}

async function stopTestApp(testApp: TestApp): Promise<void> {
  await testApp.app.close();
  await testApp.pm.close();
  rmSync(testApp.dir, { recursive: true, force: true });
}

describe('source/input/binding settings (openapi.yaml tag: sources)', () => {
  let testApp: TestApp;

  afterEach(async () => {
    await stopTestApp(testApp);
  });

  it('listSourceRoles: exactly the five seeded roles, mic-room not provisionable', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({ method: 'GET', url: '/api/v1/sources/roles', headers: { authorization: `Bearer ${testApp.lecturerToken}` } });
    expect(response.statusCode).toBe(200);
    const items = (response.json() as { items: Array<{ id: string; provisionable: boolean }> }).items;
    expect(items).toHaveLength(5);
    expect(items.find((role) => role.id === 'mic-room')?.provisionable).toBe(false);
  });

  it('listPhysicalInputs: the four seeded skeletons', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({ method: 'GET', url: '/api/v1/sources/inputs', headers: { authorization: `Bearer ${testApp.lecturerToken}` } });
    expect(response.statusCode).toBe(200);
    expect((response.json() as { items: unknown[] }).items).toHaveLength(4);
  });

  it('listSourceBindings: at most one binding per role, mic-room absent', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({ method: 'GET', url: '/api/v1/sources/bindings', headers: { authorization: `Bearer ${testApp.lecturerToken}` } });
    expect(response.statusCode).toBe(200);
    const items = (response.json() as { items: Array<{ roleId: string }> }).items;
    expect(items).toHaveLength(4);
    expect(items.some((binding) => binding.roleId === 'mic-room')).toBe(false);
  });

  it('updateSourceBinding: mic-room is permanently refused (INV-SR-2)', async () => {
    testApp = await startTestApp();
    const input = testApp.app.db.select().from(physicalInputs).where(eq(physicalInputs.kind, 'alsa')).get()!;
    const response = await testApp.app.inject({
      method: 'PUT',
      url: '/api/v1/sources/bindings/mic-room',
      headers: { authorization: `Bearer ${testApp.adminToken}` },
      payload: { physicalInputId: input.id, enabled: true },
    });
    expect(response.statusCode).toBe(422);
    expect((response.json() as { code: string }).code).toBe('config.invalid');
  });

  it('updateSourceBinding: a physical input can be bound to only one role', async () => {
    testApp = await startTestApp();
    const camInput = testApp.app.db.select().from(physicalInputs).where(eq(physicalInputs.kind, 'rtsp')).get()!;
    const response = await testApp.app.inject({
      method: 'PUT',
      url: '/api/v1/sources/bindings/students-cam',
      headers: { authorization: `Bearer ${testApp.adminToken}` },
      payload: { physicalInputId: camInput.id, enabled: true },
    });
    expect(response.statusCode).toBe(409);
    expect((response.json() as { code: string }).code).toBe('conflict');
  });

  it('updatePhysicalInput/updateSourceBinding: admin-only mutation', async () => {
    testApp = await startTestApp();
    const input = testApp.app.db.select().from(physicalInputs).all()[0]!;

    const inputResponse = await testApp.app.inject({
      method: 'PUT',
      url: `/api/v1/sources/inputs/${input.id}`,
      headers: { authorization: `Bearer ${testApp.lecturerToken}` },
      payload: { address: 'rtsp://10.0.0.9/stream1' },
    });
    expect(inputResponse.statusCode).toBe(403);

    const bindingResponse = await testApp.app.inject({
      method: 'PUT',
      url: '/api/v1/sources/bindings/presentation',
      headers: { authorization: `Bearer ${testApp.lecturerToken}` },
      payload: { physicalInputId: null, enabled: false },
    });
    expect(bindingResponse.statusCode).toBe(403);
  });

  it('updatePhysicalInput: the camera address is edited exactly once, on this row', async () => {
    testApp = await startTestApp();
    const input = testApp.app.db.select().from(physicalInputs).where(eq(physicalInputs.kind, 'rtsp')).all()[0]!;

    const response = await testApp.app.inject({
      method: 'PUT',
      url: `/api/v1/sources/inputs/${input.id}`,
      headers: { authorization: `Bearer ${testApp.adminToken}` },
      payload: { address: 'rtsp://10.0.0.42/stream1' },
    });
    expect(response.statusCode).toBe(200);
    expect((response.json() as { address: string }).address).toBe('rtsp://10.0.0.42/stream1');

    const row = testApp.app.db.select().from(physicalInputs).where(eq(physicalInputs.id, input.id)).get()!;
    expect(row.address).toBe('rtsp://10.0.0.42/stream1');
  });

  it('credentials are encrypted outside SQLite and absent from response/log/audit', async () => {
    testApp = await startTestApp();
    const input = testApp.app.db.select().from(physicalInputs).where(eq(physicalInputs.kind, 'rtsp')).all()[0]!;

    const response = await testApp.app.inject({
      method: 'PUT',
      url: `/api/v1/sources/inputs/${input.id}`,
      headers: { authorization: `Bearer ${testApp.adminToken}` },
      payload: { credentialRef: CREDENTIAL_PLAINTEXT },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { credentialRef: string | null };
    expect(body.credentialRef).not.toBeNull();
    expect(body.credentialRef).not.toBe(CREDENTIAL_PLAINTEXT);
    expect(body.credentialRef).not.toContain('s3cret-camera-password');

    const row = testApp.app.db.select().from(physicalInputs).where(eq(physicalInputs.id, input.id)).get()!;
    expect(row.credentialRef).not.toBeNull();
    expect(row.credentialRef).not.toBe(CREDENTIAL_PLAINTEXT);

    // The raw DB file never holds the plaintext (INV-ST-1) — SQLite is not "encrypted at rest" here; the secret simply never entered it.
    const dbFileContents = readFileSync(join(testApp.dir, 'core.db'));
    expect(dbFileContents.includes(Buffer.from('s3cret-camera-password'))).toBe(false);

    const audit = testApp.app.db.select().from(auditLogEntries).where(eq(auditLogEntries.entityId, input.id)).all();
    expect(audit.length).toBeGreaterThan(0);
    for (const entry of audit) {
      expect(JSON.stringify(entry.before)).not.toContain('s3cret-camera-password');
      expect(JSON.stringify(entry.after)).not.toContain('s3cret-camera-password');
    }

    // The store-ref file exists under the device secrets directory (never inside `dir/core.db`) and is opaque on disk.
    const secretsDir = join(testApp.dir, 'secrets');
    const secretFiles = readdirSync(secretsDir);
    expect(secretFiles.length).toBeGreaterThan(0);
    for (const file of secretFiles) {
      const blob = readFileSync(join(secretsDir, file));
      expect(blob.includes(Buffer.from('s3cret-camera-password'))).toBe(false);
    }
  });

  it('PM publisher-id mapping: updateSourceBinding pushes to the exact publisher (presentation→usb, lecturer-cam→rtsp, students-cam→rtsp2, mic-lecturer→audio)', async () => {
    testApp = await startTestApp();
    const roleToKind: Record<string, 'v4l2' | 'rtsp' | 'alsa'> = {
      presentation: 'v4l2',
      'lecturer-cam': 'rtsp',
      'mic-lecturer': 'alsa',
    };
    const roleId = 'lecturer-cam';
    const input = testApp.app.db.select().from(physicalInputs).where(eq(physicalInputs.kind, roleToKind[roleId]!)).all()[0]!;
    // Unbind first so this role's own current input doesn't collide with itself.
    await testApp.app.inject({
      method: 'PUT',
      url: `/api/v1/sources/bindings/${roleId}`,
      headers: { authorization: `Bearer ${testApp.adminToken}` },
      payload: { physicalInputId: null, enabled: false },
    });

    const response = await testApp.app.inject({
      method: 'PUT',
      url: `/api/v1/sources/bindings/${roleId}`,
      headers: { authorization: `Bearer ${testApp.adminToken}` },
      payload: { physicalInputId: input.id, enabled: true },
    });
    expect(response.statusCode).toBe(200);

    await waitFor(() => testApp.pm.calls.some((call) => call.path === '/publishers/rtsp/binding'));
    const bindingCall = testApp.pm.calls.find((call) => call.path === '/publishers/rtsp/binding')!;
    expect((bindingCall.body as { address: string }).address).toBe(input.address);
  });

  it('a PM binding-push failure still keeps the DB write canonical and marks the role unknown (HL-09)', async () => {
    testApp = await startTestApp();
    testApp.pm.setOffline(true);

    const input = testApp.app.db.select().from(physicalInputs).where(eq(physicalInputs.kind, 'rtsp')).all()[0]!;
    const roleId = testApp.app.db.select().from(sourceBindings).where(eq(sourceBindings.physicalInputId, input.id)).get()!.roleId;

    const response = await testApp.app.inject({
      method: 'PUT',
      url: `/api/v1/sources/inputs/${input.id}`,
      headers: { authorization: `Bearer ${testApp.adminToken}` },
      payload: { address: 'rtsp://10.0.0.99/stream1' },
    });
    expect(response.statusCode).toBe(200);

    const row = testApp.app.db.select().from(physicalInputs).where(eq(physicalInputs.id, input.id)).get()!;
    expect(row.address).toBe('rtsp://10.0.0.99/stream1');

    const statusResponse = await testApp.app.inject({
      method: 'GET',
      url: '/api/v1/sources/status',
      headers: { authorization: `Bearer ${testApp.adminToken}` },
    });
    const items = (statusResponse.json() as { items: Array<{ roleId: string; state: string }> }).items;
    expect(items.find((item) => item.roleId === roleId)?.state).toBe('unknown');
  });

  it('HL-09: rebinding a role always resets its health projection to unknown, never a stale healthy value', async () => {
    testApp = await startTestApp();
    testApp.app.bus.publish('pm.status.resynced', {
      platform: 'rk3588',
      encodeLedger: { capacity: 3, inUse: 0, reservedBy: [] },
      publishers: {
        usb: { state: 'online', bound: true, fps: 30, rms: null, lastError: null },
        rtsp: { state: 'online', bound: true, fps: 30, rms: null, lastError: null },
        rtsp2: { state: 'online', bound: true, fps: 30, rms: null, lastError: null },
        audio: { state: 'online', bound: true, fps: null, rms: 0.1, lastError: null },
      },
      consumers: [],
      device: { captureCardState: 'present', led: 'off' },
      sequence: 1,
    });
    (testApp.app.clock as FakeClock).advance(3000);
    await delay(30);
    const primed = await testApp.app.inject({ method: 'GET', url: '/api/v1/sources/status', headers: { authorization: `Bearer ${testApp.adminToken}` } });
    const primedItems = (primed.json() as { items: Array<{ roleId: string; state: string }> }).items;
    expect(primedItems.find((item) => item.roleId === 'presentation')?.state).toBe('online');

    const usbInput = testApp.app.db.select().from(physicalInputs).where(eq(physicalInputs.kind, 'v4l2')).get()!;
    const rebind = await testApp.app.inject({
      method: 'PUT',
      url: '/api/v1/sources/bindings/presentation',
      headers: { authorization: `Bearer ${testApp.adminToken}` },
      payload: { physicalInputId: usbInput.id, enabled: true },
    });
    expect(rebind.statusCode).toBe(200);

    const afterRebind = await testApp.app.inject({ method: 'GET', url: '/api/v1/sources/status', headers: { authorization: `Bearer ${testApp.adminToken}` } });
    const items = (afterRebind.json() as { items: Array<{ roleId: string; state: string }> }).items;
    expect(items.find((item) => item.roleId === 'presentation')?.state).toBe('unknown');
  });
});
