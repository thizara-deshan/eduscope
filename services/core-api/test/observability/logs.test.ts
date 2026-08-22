import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { LogEntry } from '@eduscope/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { auditLogEntries, lectureSessions, logEntries, users } from '../../src/db/schema.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { AuditWriter, redact } from '../../src/modules/observability/audit.js';
import { LogStore } from '../../src/modules/observability/store.js';
import { FakeClock } from '../fakes/clock.js';

const NOW = new Date('2026-08-21T00:00:00.000Z');

interface TestApp {
  app: FastifyInstance;
  dir: string;
  clock: FakeClock;
  lecturerToken: string;
  lecturerId: string;
  adminToken: string;
  adminSid: string;
}

async function login(app: FastifyInstance, username: string): Promise<{ token: string; sid: string }> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password: 'Password1', client: 'panel' } });
  const token = (response.json() as { tokens: { accessToken: string } }).tokens.accessToken;
  const sid = app.jwt.verify<{ sid: string }>(token).sid;
  return { token, sid };
}

async function startTestApp(configOverrides: Record<string, string> = {}): Promise<TestApp> {
  const dir = mkdtempSync(join(tmpdir(), 'core-api-logs-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    CORE_API_DB_PATH: join(dir, 'core.db'),
    CORE_API_JWT_SECRET: 'logs-test-secret',
    CORE_API_RECORDINGS_ROOT: join(dir, 'recordings'),
    ...configOverrides,
  });
  const ids = new UlidGenerator();
  const clock = new FakeClock(NOW);
  const app = await buildApp({ config, clock, ids });
  await app.lifecycle.start();

  const lecturerId = ids.next(NOW);
  await app.db
    .insert(users)
    .values([
      { id: lecturerId, username: 'lecturer1', displayName: 'Lecturer One', role: 'lecturer', source: 'local', passwordHash: await hashPassword('Password1'), mustResetPassword: false, disabled: false, createdAt: NOW.toISOString() },
      { id: ids.next(NOW), username: 'admin1', displayName: 'Admin One', role: 'admin', source: 'local', passwordHash: await hashPassword('Password1'), mustResetPassword: false, disabled: false, createdAt: NOW.toISOString() },
    ])
    .run();

  const lecturer = await login(app, 'lecturer1');
  const admin = await login(app, 'admin1');

  return { app, dir, clock, lecturerToken: lecturer.token, lecturerId, adminToken: admin.token, adminSid: admin.sid };
}

async function stopTestApp(testApp: TestApp): Promise<void> {
  await testApp.app.close();
  rmSync(testApp.dir, { recursive: true, force: true });
}

/** Minimal FK-satisfying LectureSession row — `logEntries.sessionId` references it. */
function insertSession(testApp: TestApp, sessionId: string): void {
  testApp.app.db
    .insert(lectureSessions)
    .values({
      id: sessionId,
      title: 'Test Lecture',
      hallCode: 'HALL-1',
      hallDisplayName: 'Hall 1',
      deviceId: 'device-1',
      ownerUserId: testApp.lecturerId,
      startedByActor: 'user',
      state: 'error',
      startedAt: NOW.toISOString(),
      recordedDurationMs: 0,
      pauseCount: 0,
      channelActivations: [],
      sourceSnapshot: {},
      aiEnabledAtStart: false,
    })
    .run();
}

describe('config: EDUSCOPE_CORE_LOG_MAX_ROWS / EDUSCOPE_CORE_LOG_MAX_AGE_DAYS', () => {
  it('defaults to positive values with no product-visible setting required', () => {
    const config = loadConfig({});
    expect(config.logMaxRows).toBeGreaterThan(0);
    expect(config.logMaxAgeDays).toBeGreaterThan(0);
  });

  it('rejects a non-positive row limit', () => {
    expect(() => loadConfig({ EDUSCOPE_CORE_LOG_MAX_ROWS: '0' })).toThrow();
    expect(() => loadConfig({ EDUSCOPE_CORE_LOG_MAX_ROWS: '-5' })).toThrow();
  });

  it('rejects a non-positive age limit', () => {
    expect(() => loadConfig({ EDUSCOPE_CORE_LOG_MAX_AGE_DAYS: '0' })).toThrow();
    expect(() => loadConfig({ EDUSCOPE_CORE_LOG_MAX_AGE_DAYS: '-1' })).toThrow();
  });
});

describe('LogStore', () => {
  let testApp: TestApp;

  afterEach(async () => {
    await stopTestApp(testApp);
  });

  it('write() appends an entry, returns the exact contract shape, and bridges it onto the bus as log.entry', async () => {
    testApp = await startTestApp();
    const store = new LogStore({ db: testApp.app.db, clock: testApp.clock, ids: new UlidGenerator(), bus: testApp.app.bus, maxRows: 1000, maxAgeDays: 90 });

    const received: LogEntry[] = [];
    testApp.app.bus.subscribe('log.entry', (entry) => received.push(entry));

    const entry = store.write({ level: 'WARN', category: 'System', service: 'core-api', message: 'disk nearly full' });

    expect(new Set(Object.keys(entry))).toEqual(new Set(['id', 'at', 'level', 'category', 'service', 'message', 'context', 'sessionId', 'userId']));
    expect(entry.level).toBe('WARN');
    expect(entry.context).toBeNull();
    expect(entry.sessionId).toBeNull();
    expect(entry.userId).toBeNull();

    const rows = testApp.app.db.select().from(logEntries).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.message).toBe('disk nearly full');

    expect(received).toHaveLength(1);
    expect(received[0]!.id).toBe(entry.id);
  });

  it('rotates the oldest rows first once the row-count policy is exceeded', async () => {
    testApp = await startTestApp();
    const store = new LogStore({ db: testApp.app.db, clock: testApp.clock, ids: new UlidGenerator(), bus: testApp.app.bus, maxRows: 3, maxAgeDays: 9000 });

    for (let i = 0; i < 5; i += 1) {
      store.write({ level: 'INFO', category: 'System', service: 'core-api', message: `entry-${i}` });
      testApp.clock.advance(1000);
    }

    const rows = testApp.app.db.select({ message: logEntries.message }).from(logEntries).all();
    expect(rows.map((r) => r.message).sort()).toEqual(['entry-2', 'entry-3', 'entry-4']);
  });

  it('rotates rows older than the age policy', async () => {
    testApp = await startTestApp();
    // A standalone clock decoupled from the app's own lifecycle timers
    // (upload scheduler, storage probe, alert reevaluation, ...) — advancing
    // those by two virtual days would otherwise fire tens of thousands of
    // real ticks against the shared app clock.
    const storeClock = new FakeClock(NOW);
    const store = new LogStore({ db: testApp.app.db, clock: storeClock, ids: new UlidGenerator(), bus: testApp.app.bus, maxRows: 1000, maxAgeDays: 1 });

    store.write({ level: 'INFO', category: 'System', service: 'core-api', message: 'old' });
    storeClock.advance(2 * 24 * 60 * 60 * 1000);
    store.write({ level: 'INFO', category: 'System', service: 'core-api', message: 'new' });

    const rows = testApp.app.db.select({ message: logEntries.message }).from(logEntries).all();
    expect(rows.map((r) => r.message)).toEqual(['new']);
  });

  it('filters by level/category/q/from/to/sessionId and paginates newest-first by cursor', async () => {
    testApp = await startTestApp();
    const store = new LogStore({ db: testApp.app.db, clock: testApp.clock, ids: new UlidGenerator(), bus: testApp.app.bus, maxRows: 1000, maxAgeDays: 9000 });
    const sessionId = new UlidGenerator().next(NOW);
    insertSession(testApp, sessionId);

    store.write({ level: 'ERROR', category: 'Hardware', service: 'core-api', message: 'capture card offline', sessionId });
    testApp.clock.advance(1000);
    store.write({ level: 'INFO', category: 'Auth', service: 'core-api', message: 'login succeeded' });
    testApp.clock.advance(1000);
    store.write({ level: 'ERROR', category: 'Hardware', service: 'core-api', message: 'mic gain apply failed' });

    expect(store.query({ level: 'ERROR', limit: 10 }).items).toHaveLength(2);
    expect(store.query({ category: 'Auth', limit: 10 }).items).toHaveLength(1);
    expect(store.query({ q: 'gain', limit: 10 }).items.map((e) => e.message)).toEqual(['mic gain apply failed']);
    expect(store.query({ sessionId, limit: 10 }).items.map((e) => e.message)).toEqual(['capture card offline']);
    expect(store.query({ from: new Date(NOW.getTime() + 1500).toISOString(), limit: 10 }).items).toHaveLength(1);
    expect(store.query({ to: new Date(NOW.getTime() + 500).toISOString(), limit: 10 }).items).toHaveLength(1);

    const firstPage = store.query({ limit: 2 });
    expect(firstPage.items.map((e) => e.message)).toEqual(['mic gain apply failed', 'login succeeded']);
    expect(firstPage.nextCursor).not.toBeNull();
    const secondPage = store.query({ limit: 2, cursor: firstPage.nextCursor! });
    expect(secondPage.items.map((e) => e.message)).toEqual(['capture card offline']);
    expect(secondPage.nextCursor).toBeNull();
  });

  it('accepts AI attribution as service:"ai" with context.subservice in stt|slide|question', async () => {
    testApp = await startTestApp();
    const store = new LogStore({ db: testApp.app.db, clock: testApp.clock, ids: new UlidGenerator(), bus: testApp.app.bus, maxRows: 1000, maxAgeDays: 9000 });

    for (const subservice of ['stt', 'slide', 'question'] as const) {
      store.write({ level: 'ERROR', category: 'System', service: 'ai', message: `${subservice} unreachable`, context: { subservice } });
    }

    const items = store.query({ limit: 10 }).items;
    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(item.service).toBe('ai');
      expect(['stt', 'slide', 'question']).toContain((item.context as { subservice: string }).subservice);
    }
  });
});

describe('redact()', () => {
  it('strips secret-shaped keys from nested before/after snapshots', () => {
    const redacted = redact({ username: 'a', passwordHash: 'x', nested: { streamKey: 'rtmp-key', ok: 1 }, list: [{ token: 'abc' }] });
    expect(redacted).toEqual({ username: 'a', passwordHash: '[redacted]', nested: { streamKey: '[redacted]', ok: 1 }, list: [{ token: '[redacted]' }] });
  });
});

describe('AuditWriter', () => {
  let testApp: TestApp;

  afterEach(async () => {
    await stopTestApp(testApp);
  });

  it('write() persists a redacted audit row', async () => {
    testApp = await startTestApp();
    const writer = new AuditWriter({ db: testApp.app.db, clock: testApp.clock, ids: new UlidGenerator() });

    writer.write({
      actorUserId: null,
      actorKind: 'system',
      entityType: 'StreamTarget',
      entityId: 'target-1',
      action: 'config-change',
      before: { streamKey: 'old-secret' },
      after: { streamKey: 'new-secret' },
    });

    const row = testApp.app.db.select().from(auditLogEntries).where(eq(auditLogEntries.entityId, 'target-1')).get()!;
    expect(row.before).toEqual({ streamKey: '[redacted]' });
    expect(row.after).toEqual({ streamKey: '[redacted]' });
  });
});

describe('observability REST (openapi.yaml tag: logs — queryLogs, exportLogsCsv)', () => {
  let testApp: TestApp;

  afterEach(async () => {
    await stopTestApp(testApp);
  });

  it('queryLogs: 403 for a non-admin', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({ method: 'GET', url: '/api/v1/logs', headers: { authorization: `Bearer ${testApp.lecturerToken}` } });
    expect(response.statusCode).toBe(403);
  });

  it('exportLogsCsv: 403 for a non-admin', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({ method: 'GET', url: '/api/v1/logs/export', headers: { authorization: `Bearer ${testApp.lecturerToken}` } });
    expect(response.statusCode).toBe(403);
  });

  it('queryLogs: 200 returns the written entries, newest first, with explicit columns only', async () => {
    testApp = await startTestApp();
    testApp.app.logStore.write({ level: 'INFO', category: 'System', service: 'core-api', message: 'first' });
    testApp.clock.advance(1000);
    testApp.app.logStore.write({ level: 'INFO', category: 'System', service: 'core-api', message: 'second' });

    const response = await testApp.app.inject({ method: 'GET', url: '/api/v1/logs', headers: { authorization: `Bearer ${testApp.adminToken}` } });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { items: LogEntry[]; nextCursor: string | null };
    expect(body.items.map((i) => i.message)).toEqual(['second', 'first']);
    expect(new Set(Object.keys(body.items[0]!))).toEqual(new Set(['id', 'at', 'level', 'category', 'service', 'message', 'context', 'sessionId', 'userId']));
  });

  it('queryLogs: refreshes the CG-3 scoped log.entry subscription for a 120-second TTL', async () => {
    testApp = await startTestApp();
    await testApp.app.inject({ method: 'GET', url: '/api/v1/logs', headers: { authorization: `Bearer ${testApp.adminToken}` } });

    expect(testApp.app.scopedSubscriptions.allows(testApp.adminSid, 'log.entry')).toBe(true);
    testApp.clock.advance(120_001);
    expect(testApp.app.scopedSubscriptions.allows(testApp.adminSid, 'log.entry')).toBe(false);
  });

  it('exportLogsCsv: 200 streams RFC 4180 CSV with a stable header and escaped fields', async () => {
    testApp = await startTestApp();
    testApp.app.logStore.write({ level: 'ERROR', category: 'System', service: 'core-api', message: 'contains, a comma and a "quote"' });

    const response = await testApp.app.inject({ method: 'GET', url: '/api/v1/logs/export', headers: { authorization: `Bearer ${testApp.adminToken}` } });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');

    const lines = response.body.split('\r\n').filter((line) => line.length > 0);
    expect(lines[0]).toBe('id,at,level,category,service,message,context,sessionId,userId');
    expect(lines[1]).toContain('"contains, a comma and a ""quote"""');
  });

  it('mirrors a recording failure into exactly one log_entries row and one log.entry event', async () => {
    testApp = await startTestApp();
    const received: LogEntry[] = [];
    testApp.app.bus.subscribe('log.entry', (entry) => received.push(entry));

    const sessionId = new UlidGenerator().next(NOW);
    insertSession(testApp, sessionId);
    testApp.app.bus.publish('recording.state', {
      state: 'error',
      startReason: null,
      sessionId,
      title: 'Failed Lecture',
      ownerUserId: null,
      ownerDisplayName: null,
      startedAt: null,
      recordedDurationMs: null,
      segmentIndex: null,
      segmentCount: null,
      pauseCount: null,
      takeoverBy: null,
      takeoverAt: null,
      takeoverByDisplayName: null,
      errorCode: 'confirm_timeout',
      errorMessage: 'pipeline-manager never confirmed the start',
    });

    expect(received).toHaveLength(1);
    expect(received[0]!.level).toBe('ERROR');
    expect(received[0]!.category).toBe('Session');
    expect(received[0]!.sessionId).toBe(sessionId);

    const rows = testApp.app.db.select().from(logEntries).where(eq(logEntries.sessionId, sessionId)).all();
    expect(rows).toHaveLength(1);

    // A non-error transition never writes a row (mirrored once, not on every transition).
    testApp.app.bus.publish('recording.state', {
      state: 'idle',
      startReason: null,
      sessionId: null,
      title: null,
      ownerUserId: null,
      ownerDisplayName: null,
      startedAt: null,
      recordedDurationMs: null,
      segmentIndex: null,
      segmentCount: null,
      pauseCount: null,
      takeoverBy: null,
      takeoverAt: null,
      takeoverByDisplayName: null,
      errorCode: null,
      errorMessage: null,
    });
    expect(received).toHaveLength(1);
  });
});
