import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { RecordingStatePayload } from '@eduscope/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { auditLogEntries, lectureSessions, storageVolumes, users } from '../../src/db/schema.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { FakeClock } from '../fakes/clock.js';
import { FakePipelineManager } from '../fakes/pipeline-manager.js';

const NOW = new Date('2026-06-01T09:00:00.000Z');
const BEARER = 'test-pm-bearer-authority';
const FIRST_CONSUMER_ID = 'record:00000001';

async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: condition not met in time');
    await delay(5);
  }
}

interface TestContext {
  dir: string;
  app: FastifyInstance;
  pm: FakePipelineManager;
  ownerToken: string;
  ownerId: string;
  otherLecturerToken: string;
  adminToken: string;
  adminId: string;
}

async function loginAs(app: FastifyInstance, username: string, password: string): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password, client: 'panel' } });
  return (response.json() as { tokens: { accessToken: string } }).tokens.accessToken;
}

async function createContext(): Promise<TestContext> {
  const dir = mkdtempSync(join(tmpdir(), 'core-api-recording-authority-'));
  const pm = new FakePipelineManager({ bearerToken: BEARER });
  const pmBaseUrl = await pm.listen();

  const provisioningPath = join(dir, 'provisioning.json');
  writeFileSync(
    provisioningPath,
    JSON.stringify({ deviceId: 'device-1', hallCode: 'LAC001', hallDisplayName: 'Lecture Hall 1', titlePattern: '{hall} – {date} {time}' }),
  );

  const config = loadConfig({
    NODE_ENV: 'test',
    CORE_API_DB_PATH: join(dir, 'core.db'),
    CORE_API_JWT_SECRET: 'recording-authority-test-secret',
    CORE_API_PROVISIONING_PATH: provisioningPath,
    CORE_API_RECORDINGS_ROOT: join(dir, 'recordings'),
    CORE_API_PM_BASE_URL: pmBaseUrl,
    CORE_API_INTERNAL_BEARER: BEARER,
  });

  const clock = new FakeClock(NOW);
  const ids = new UlidGenerator();
  const app = await buildApp({ config, clock, ids });
  await app.lifecycle.start();
  await waitFor(() => pm.openConnectionCount === 1);

  const ownerId = ids.next(NOW);
  app.db
    .insert(users)
    .values({
      id: ownerId,
      username: 'owner',
      displayName: 'Owner Lecturer',
      role: 'lecturer',
      source: 'local',
      passwordHash: await hashPassword('Password1'),
      mustResetPassword: false,
      disabled: false,
      createdAt: NOW.toISOString(),
    })
    .run();
  app.db
    .insert(users)
    .values({
      id: ids.next(NOW),
      username: 'otherlecturer',
      displayName: 'Other Lecturer',
      role: 'lecturer',
      source: 'local',
      passwordHash: await hashPassword('Password1'),
      mustResetPassword: false,
      disabled: false,
      createdAt: NOW.toISOString(),
    })
    .run();
  const adminId = ids.next(NOW);
  app.db
    .insert(users)
    .values({
      id: adminId,
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

  app.db
    .insert(storageVolumes)
    .values({
      id: ids.next(NOW),
      uuid: 'recordings-volume-1',
      devicePath: '/dev/sda1',
      mountPath: '/media/eduscope',
      filesystem: 'ext4',
      capacityBytes: 1_000_000_000_000,
      freeBytes: 500_000_000_000,
      smartStatus: 'good',
      role: 'recordings',
      state: 'mounted',
      registeredAt: NOW.toISOString(),
    })
    .run();

  const ownerToken = await loginAs(app, 'owner', 'Password1');
  const otherLecturerToken = await loginAs(app, 'otherlecturer', 'Password1');
  const adminToken = await loginAs(app, 'admin1', 'Password1');

  return { dir, app, pm, ownerToken, ownerId, otherLecturerToken, adminToken, adminId };
}

async function destroyContext(ctx: TestContext): Promise<void> {
  await ctx.app.close();
  await ctx.pm.close();
  rmSync(ctx.dir, { recursive: true, force: true });
}

async function post(ctx: TestContext, path: string, accessToken: string): Promise<{ statusCode: number; body: unknown }> {
  const response = await ctx.app.inject({ method: 'POST', url: `/api/v1/recording/${path}`, headers: { authorization: `Bearer ${accessToken}` } });
  return { statusCode: response.statusCode, body: response.json() };
}

async function startAndConfirm(ctx: TestContext): Promise<void> {
  await post(ctx, 'start', ctx.ownerToken);
  await waitFor(() => ctx.pm.calls.some((call) => call.path === '/consumers/record'));
  ctx.pm.publish('evt.pm.consumer.running', { consumerId: FIRST_CONSUMER_ID, pgid: 1 });
  await waitFor(() => firstSession(ctx).state === 'recording');
}

function firstSession(ctx: TestContext): typeof lectureSessions.$inferSelect {
  return ctx.app.db.select().from(lectureSessions).all()[0]!;
}

describe('Recorder lock and takeover (R-21, LP-6, KEEP B-15)', () => {
  let ctx: TestContext;

  afterEach(async () => {
    await destroyContext(ctx);
  });

  it('user A locks the recording: a non-owner, non-admin lecturer (user B) is refused', async () => {
    ctx = await createContext();
    await startAndConfirm(ctx);

    const refusal = await post(ctx, 'takeover', ctx.otherLecturerToken);

    expect(refusal.statusCode).toBe(403);
    expect((refusal.body as { code: string }).code).toBe('not-authorized');
    expect(firstSession(ctx).ownerUserId).toBe(ctx.ownerId);
    expect(firstSession(ctx).takeoverBy).toBeNull();
  });

  it('the owner themselves cannot take over (only an admin can)', async () => {
    ctx = await createContext();
    await startAndConfirm(ctx);

    const refusal = await post(ctx, 'takeover', ctx.ownerToken);

    expect(refusal.statusCode).toBe(403);
    expect((refusal.body as { code: string }).code).toBe('not-authorized');
  });

  it('takeover with no active recording is refused with session.not-active', async () => {
    ctx = await createContext();

    const refusal = await post(ctx, 'takeover', ctx.adminToken);

    expect(refusal.statusCode).toBe(409);
    expect((refusal.body as { code: string }).code).toBe('session.not-active');
  });

  it('admin takeover preserves the original owner, sets takeover fields, audits, and revokes the displaced owner panel session', async () => {
    ctx = await createContext();
    await startAndConfirm(ctx);

    const takeover = await post(ctx, 'takeover', ctx.adminToken);
    expect(takeover.statusCode).toBe(202);

    const session = firstSession(ctx);
    expect(session.ownerUserId).toBe(ctx.ownerId); // ownership itself never changes (INV-LS-2)
    expect(session.takeoverBy).toBe(ctx.adminId);
    expect(session.takeoverAt).not.toBeNull();

    const audit = ctx.app.db.select().from(auditLogEntries).where(eq(auditLogEntries.sessionId, session.id)).all();
    expect(audit).toHaveLength(1);
    expect(audit[0]!.action).toBe('takeover');
    expect(audit[0]!.actorUserId).toBe(ctx.adminId);

    // KEEP B-15: the displaced owner's panel authority ends immediately.
    const displacedCheck = await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${ctx.ownerToken}` } });
    expect(displacedCheck.statusCode).toBe(401);
    expect((displacedCheck.json() as { code: string }).code).toBe('auth.session-revoked');

    // The admin's own session, and any future login by the original owner, are unaffected by the revocation scope.
    const adminCheck = await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${ctx.adminToken}` } });
    expect(adminCheck.statusCode).toBe(200);
  });

  it('recording.state carries takeoverBy/takeoverAt/takeoverByDisplayName after takeover', async () => {
    ctx = await createContext();
    await startAndConfirm(ctx);
    const events: RecordingStatePayload[] = [];
    ctx.app.bus.subscribe('recording.state', (payload) => events.push(payload));

    await post(ctx, 'takeover', ctx.adminToken);

    const takeoverEvent = events.at(-1)!;
    expect(takeoverEvent.takeoverBy).toBe(ctx.adminId);
    expect(takeoverEvent.takeoverByDisplayName).toBe('Admin One');
    expect(takeoverEvent.takeoverAt).not.toBeNull();
  });
});
