import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import type { User } from '@eduscope/shared';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { authSessions, lectureSessions, recordings, users } from '../../src/db/schema.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { FakeClock } from '../fakes/clock.js';
import { InMemoryHelperTransport } from '../fakes/helper-server.js';
import { FakePipelineManager } from '../fakes/pipeline-manager.js';

const NOW = new Date('2026-08-19T00:00:00.000Z');
const BEARER = 'users-test-pm-bearer';

interface TestApp {
  app: FastifyInstance;
  dir: string;
  pm: FakePipelineManager;
  ids: UlidGenerator;
  adminId: string;
  admin2Id: string;
  lecturerId: string;
  adminToken: string;
  admin2Token: string;
  lecturerToken: string;
}

async function loginAs(app: FastifyInstance, username: string, password: string): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password, client: 'panel' } });
  return (response.json() as { tokens: { accessToken: string } }).tokens.accessToken;
}

async function startTestApp(): Promise<TestApp> {
  const dir = mkdtempSync(join(tmpdir(), 'core-api-users-'));
  const pm = new FakePipelineManager({ bearerToken: BEARER });
  const pmBaseUrl = await pm.listen();

  const provisioningPath = join(dir, 'provisioning.json');
  writeFileSync(provisioningPath, JSON.stringify({ deviceId: 'device-1', hallCode: 'LAC001', hallDisplayName: 'Lecture Hall 1', titlePattern: '{hall} – {date} {time}' }));

  const config = loadConfig({
    NODE_ENV: 'test',
    CORE_API_DB_PATH: join(dir, 'core.db'),
    CORE_API_JWT_SECRET: 'users-test-secret',
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
  const admin2Id = ids.next(NOW);
  const lecturerId = ids.next(NOW);

  await app.db
    .insert(users)
    .values([
      { id: adminId, username: 'admin1', displayName: 'Admin One', role: 'admin', source: 'local', passwordHash: await hashPassword('Password1'), mustResetPassword: false, disabled: false, createdAt: NOW.toISOString() },
      { id: admin2Id, username: 'admin2', displayName: 'Admin Two', role: 'admin', source: 'local', passwordHash: await hashPassword('Password1'), mustResetPassword: false, disabled: false, createdAt: NOW.toISOString() },
      { id: lecturerId, username: 'lecturer1', displayName: 'Lecturer One', role: 'lecturer', source: 'local', passwordHash: await hashPassword('Password1'), mustResetPassword: false, disabled: false, createdAt: NOW.toISOString() },
    ])
    .run();

  const adminToken = await loginAs(app, 'admin1', 'Password1');
  const admin2Token = await loginAs(app, 'admin2', 'Password1');
  const lecturerToken = await loginAs(app, 'lecturer1', 'Password1');

  return { app, dir, pm, ids, adminId, admin2Id, lecturerId, adminToken, admin2Token, lecturerToken };
}

async function stopTestApp(testApp: TestApp): Promise<void> {
  await testApp.app.close();
  await testApp.pm.close();
  rmSync(testApp.dir, { recursive: true, force: true });
}

function auth(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

describe('users CRUD (openapi.yaml tag: users)', () => {
  let testApp: TestApp;
  afterEach(async () => stopTestApp(testApp));

  it('list/create/update/delete are admin-only', async () => {
    testApp = await startTestApp();

    const list = await testApp.app.inject({ method: 'GET', url: '/api/v1/users', headers: auth(testApp.lecturerToken) });
    expect(list.statusCode).toBe(403);

    const create = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: auth(testApp.lecturerToken),
      payload: { username: 'new1', displayName: 'New One', role: 'lecturer', password: 'Password1' },
    });
    expect(create.statusCode).toBe(403);

    const update = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${testApp.lecturerId}`,
      headers: auth(testApp.lecturerToken),
      payload: { displayName: 'Renamed' },
    });
    expect(update.statusCode).toBe(403);

    const del = await testApp.app.inject({ method: 'DELETE', url: `/api/v1/users/${testApp.lecturerId}`, headers: auth(testApp.lecturerToken) });
    expect(del.statusCode).toBe(403);
  });

  it('createUser: forces reset, is local-source, never returns a password hash, and 409s on a duplicate username', async () => {
    testApp = await startTestApp();

    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: auth(testApp.adminToken),
      payload: { username: 'newlecturer', displayName: 'New Lecturer', role: 'lecturer', password: 'Password1' },
    });
    expect(response.statusCode).toBe(201);
    const created = response.json() as User;
    expect(created.mustResetPassword).toBe(true);
    expect(created.source).toBe('local');
    expect(created).not.toHaveProperty('passwordHash');

    const row = testApp.app.db.select().from(users).where(eq(users.id, created.id)).get()!;
    expect(row.passwordHash).not.toBe('Password1');

    const duplicate = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: auth(testApp.adminToken),
      payload: { username: 'newlecturer', displayName: 'Duplicate', role: 'lecturer', password: 'Password1' },
    });
    expect(duplicate.statusCode).toBe(409);
    expect((duplicate.json() as { code: string }).code).toBe('conflict');
  });

  it('listUsers: paginates and filters by q/role, never exposing a password hash', async () => {
    testApp = await startTestApp();

    const page1 = await testApp.app.inject({ method: 'GET', url: '/api/v1/users?limit=2', headers: auth(testApp.adminToken) });
    expect(page1.statusCode).toBe(200);
    const body1 = page1.json() as { items: User[]; nextCursor: string | null };
    expect(body1.items).toHaveLength(2);
    expect(body1.nextCursor).not.toBeNull();
    for (const item of body1.items) expect(item).not.toHaveProperty('passwordHash');

    const page2 = await testApp.app.inject({
      method: 'GET',
      url: `/api/v1/users?limit=2&cursor=${encodeURIComponent(body1.nextCursor!)}`,
      headers: auth(testApp.adminToken),
    });
    const body2 = page2.json() as { items: User[]; nextCursor: string | null };
    expect(body2.items).toHaveLength(1);
    expect(body2.nextCursor).toBeNull();

    const byRole = await testApp.app.inject({ method: 'GET', url: '/api/v1/users?role=lecturer', headers: auth(testApp.adminToken) });
    const roleBody = byRole.json() as { items: User[] };
    expect(roleBody.items.every((item) => item.role === 'lecturer')).toBe(true);

    const byQuery = await testApp.app.inject({ method: 'GET', url: '/api/v1/users?q=lecturer1', headers: auth(testApp.adminToken) });
    const queryBody = byQuery.json() as { items: User[] };
    expect(queryBody.items.map((item) => item.username)).toEqual(['lecturer1']);
  });

  it('updateUser: forces reset when a password is set and 404s an unknown user', async () => {
    testApp = await startTestApp();

    const response = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${testApp.lecturerId}`,
      headers: auth(testApp.adminToken),
      payload: { password: 'NewPassword1' },
    });
    expect(response.statusCode).toBe(200);
    expect((response.json() as User).mustResetPassword).toBe(true);

    const missing = await testApp.app.inject({
      method: 'PATCH',
      url: '/api/v1/users/01ARZ3NDEKTSV4RRFFQ69G5FAV',
      headers: auth(testApp.adminToken),
      payload: { displayName: 'Nobody' },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('last enabled admin guard: refuses leaving zero enabled admins even without a self-disable', async () => {
    testApp = await startTestApp();

    // Disabling the other admin (non-self) is unaffected by the guard — admin1 remains enabled.
    const disableOther = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${testApp.admin2Id}`,
      headers: auth(testApp.adminToken),
      payload: { disabled: true },
    });
    expect(disableOther.statusCode).toBe(200);

    // admin1 is now the sole enabled admin. Demoting itself (without touching `disabled`, so the
    // unconditional self-action guard never enters the picture) must still be refused — it would
    // leave zero enabled admins able to administer the device.
    const selfDemote = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${testApp.adminId}`,
      headers: auth(testApp.adminToken),
      payload: { role: 'lecturer' },
    });
    expect(selfDemote.statusCode).toBe(409);
    expect((selfDemote.json() as { code: string }).code).toBe('conflict');

    // A fresh admin cannot be demoted/disabled/deleted down to zero either: re-enable admin2, then
    // delete admin1, leaving admin2 as the sole enabled admin, and prove it survives its own demotion.
    testApp.app.db.update(users).set({ disabled: false }).where(eq(users.id, testApp.admin2Id)).run();
    const freshAdmin2Token = await loginAs(testApp.app, 'admin2', 'Password1');
    const deleteAdmin1 = await testApp.app.inject({ method: 'DELETE', url: `/api/v1/users/${testApp.adminId}`, headers: auth(freshAdmin2Token) });
    expect(deleteAdmin1.statusCode).toBe(204);

    const secondSelfDemote = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${testApp.admin2Id}`,
      headers: auth(freshAdmin2Token),
      payload: { role: 'lecturer' },
    });
    expect(secondSelfDemote.statusCode).toBe(409);
  });

  it('self-delete/self-disable guard: an admin cannot disable or delete their own account, regardless of other admins', async () => {
    testApp = await startTestApp();

    const selfDisable = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${testApp.adminId}`,
      headers: auth(testApp.adminToken),
      payload: { disabled: true },
    });
    expect(selfDisable.statusCode).toBe(409);

    const selfDelete = await testApp.app.inject({ method: 'DELETE', url: `/api/v1/users/${testApp.adminId}`, headers: auth(testApp.adminToken) });
    expect(selfDelete.statusCode).toBe(409);

    // self-editing something other than disabled/deletion is fine
    const selfRename = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${testApp.adminId}`,
      headers: auth(testApp.adminToken),
      payload: { displayName: 'Renamed Admin' },
    });
    expect(selfRename.statusCode).toBe(200);
  });

  it('deleteUser: soft-deletes (tombstones), preserves owned recordings, is idempotent, and revokes active sessions', async () => {
    testApp = await startTestApp();

    const sessionId = testApp.ids.next(NOW);
    const recordingId = testApp.ids.next(NOW);
    testApp.app.db
      .insert(lectureSessions)
      .values({
        id: sessionId,
        title: 'Lecture',
        hallCode: 'HALL-1',
        hallDisplayName: 'Hall 1',
        deviceId: 'device-1',
        ownerUserId: testApp.lecturerId,
        startedByActor: 'user',
        state: 'completed',
        startedAt: NOW.toISOString(),
        endedAt: NOW.toISOString(),
        recordedDurationMs: 0,
        pauseCount: 0,
        channelActivations: [],
        sourceSnapshot: {},
        aiEnabledAtStart: false,
      })
      .run();
    testApp.app.db
      .insert(recordings)
      .values({
        id: recordingId,
        sessionId,
        ownerUserId: testApp.lecturerId,
        state: 'ready',
        mergeState: 'done',
        layoutPresetId: 'pc-only',
        segmentCount: 1,
        retentionDeleteAfter: NOW.toISOString(),
        playbackAuthRequired: true,
      })
      .run();

    const del = await testApp.app.inject({ method: 'DELETE', url: `/api/v1/users/${testApp.lecturerId}`, headers: auth(testApp.adminToken) });
    expect(del.statusCode).toBe(204);

    const userRow = testApp.app.db.select().from(users).where(eq(users.id, testApp.lecturerId)).get()!;
    expect(userRow.disabled).toBe(true);

    const recordingRow = testApp.app.db.select().from(recordings).where(eq(recordings.id, recordingId)).get()!;
    expect(recordingRow.ownerUserId).toBe(testApp.lecturerId);

    const sessionRow = testApp.app.db.select().from(authSessions).where(eq(authSessions.userId, testApp.lecturerId)).get();
    expect(sessionRow?.revokedAt).not.toBeNull();
    expect(sessionRow?.revokedReason).toBe('admin');

    // idempotent repeat
    const again = await testApp.app.inject({ method: 'DELETE', url: `/api/v1/users/${testApp.lecturerId}`, headers: auth(testApp.adminToken) });
    expect(again.statusCode).toBe(204);

    const missing = await testApp.app.inject({ method: 'DELETE', url: '/api/v1/users/01ARZ3NDEKTSV4RRFFQ69G5FAV', headers: auth(testApp.adminToken) });
    expect(missing.statusCode).toBe(404);
  });

  it('disabling an active session revokes it immediately', async () => {
    testApp = await startTestApp();

    const before = testApp.app.db.select().from(authSessions).where(eq(authSessions.userId, testApp.lecturerId)).get();
    expect(before?.revokedAt).toBeNull();

    const disable = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${testApp.lecturerId}`,
      headers: auth(testApp.adminToken),
      payload: { disabled: true },
    });
    expect(disable.statusCode).toBe(200);

    const after = testApp.app.db.select().from(authSessions).where(eq(authSessions.userId, testApp.lecturerId)).get();
    expect(after?.revokedAt).not.toBeNull();

    const useOldToken = await testApp.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(testApp.lecturerToken) });
    expect(useOldToken.statusCode).toBe(401);
  });
});
