import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { RecordingArtifactPayload } from '@eduscope/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { auditLogEntries, authSessions, exportJobs, lectureSessions, recordingFiles, recordingSegments, recordings, uploadJobs, users } from '../../src/db/schema.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { FakeClock } from '../fakes/clock.js';
import { FakePipelineManager } from '../fakes/pipeline-manager.js';

const NOW = new Date('2026-07-01T00:00:00.000Z');
const BEARER = 'library-test-pm-bearer';

interface TestApp {
  app: FastifyInstance;
  dir: string;
  recordingsRoot: string;
  pm: FakePipelineManager;
  ids: UlidGenerator;
  ownerId: string;
  otherOwnerId: string;
  adminId: string;
  ownerToken: string;
  otherOwnerToken: string;
  adminToken: string;
}

async function loginAs(app: FastifyInstance, username: string, password: string): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password, client: 'panel' } });
  return (response.json() as { tokens: { accessToken: string } }).tokens.accessToken;
}

async function startTestApp(): Promise<TestApp> {
  const dir = mkdtempSync(join(tmpdir(), 'core-api-library-'));
  const recordingsRoot = join(dir, 'recordings');
  const pm = new FakePipelineManager({ bearerToken: BEARER });
  const pmBaseUrl = await pm.listen();

  const config = loadConfig({
    NODE_ENV: 'test',
    CORE_API_DB_PATH: join(dir, 'core.db'),
    CORE_API_JWT_SECRET: 'library-test-secret',
    CORE_API_RECORDINGS_ROOT: recordingsRoot,
    CORE_API_PM_BASE_URL: pmBaseUrl,
    CORE_API_INTERNAL_BEARER: BEARER,
  });

  const ids = new UlidGenerator();
  const app = await buildApp({ config, clock: new FakeClock(NOW), ids });
  await app.lifecycle.start();

  const ownerId = ids.next(NOW);
  const otherOwnerId = ids.next(NOW);
  const adminId = ids.next(NOW);

  await app.db
    .insert(users)
    .values([
      { id: ownerId, username: 'owner', displayName: 'Owner Lecturer', role: 'lecturer', source: 'local', passwordHash: await hashPassword('Password1'), mustResetPassword: false, disabled: false, createdAt: NOW.toISOString() },
      { id: otherOwnerId, username: 'other', displayName: 'Other Lecturer', role: 'lecturer', source: 'local', passwordHash: await hashPassword('Password1'), mustResetPassword: false, disabled: false, createdAt: NOW.toISOString() },
      { id: adminId, username: 'admin1', displayName: 'Admin One', role: 'admin', source: 'local', passwordHash: await hashPassword('Password1'), mustResetPassword: false, disabled: false, createdAt: NOW.toISOString() },
    ])
    .run();

  const ownerToken = await loginAs(app, 'owner', 'Password1');
  const otherOwnerToken = await loginAs(app, 'other', 'Password1');
  const adminToken = await loginAs(app, 'admin1', 'Password1');

  return { app, dir, recordingsRoot, pm, ids, ownerId, otherOwnerId, adminId, ownerToken, otherOwnerToken, adminToken };
}

async function stopTestApp(testApp: TestApp): Promise<void> {
  await testApp.app.close();
  await testApp.pm.close();
  rmSync(testApp.dir, { recursive: true, force: true });
}

interface SeedRecordingOptions {
  recordingId: string;
  sessionId: string;
  ownerUserId: string;
  title?: string;
  startedAt: Date;
  state?: 'capturing' | 'finalizing' | 'merging' | 'ready' | 'failed' | 'deleted';
  mergeState?: 'not-needed' | 'pending' | 'running' | 'done' | 'failed';
}

function seedRecording(testApp: TestApp, opts: SeedRecordingOptions): void {
  testApp.app.db
    .insert(lectureSessions)
    .values({
      id: opts.sessionId,
      title: opts.title ?? 'Lecture',
      hallCode: 'HALL-1',
      hallDisplayName: 'Hall 1',
      deviceId: 'device-1',
      ownerUserId: opts.ownerUserId,
      startedByActor: 'user',
      state: 'completed',
      startedAt: opts.startedAt.toISOString(),
      endedAt: opts.startedAt.toISOString(),
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
      id: opts.recordingId,
      sessionId: opts.sessionId,
      ownerUserId: opts.ownerUserId,
      state: opts.state ?? 'ready',
      layoutPresetId: 'pc-only',
      segmentCount: 1,
      mergeState: opts.mergeState ?? 'done',
      retentionDeleteAfter: opts.startedAt.toISOString(),
      playbackAuthRequired: true,
    })
    .run();
}

function seedFile(testApp: TestApp, opts: { fileId: string; recordingId: string; path: string; bytes: number }): void {
  mkdirSync(join(opts.path, '..'), { recursive: true });
  writeFileSync(opts.path, Buffer.alloc(opts.bytes, 1));
  testApp.app.db
    .insert(recordingFiles)
    .values({
      id: opts.fileId,
      recordingId: opts.recordingId,
      segmentId: null,
      kind: 'derived',
      streamKey: 'main',
      path: opts.path,
      container: 'mp4',
      sizeBytes: opts.bytes,
      durationMs: 1000,
      state: 'finalized',
      hasAudio: true,
      isUploadable: true,
    })
    .run();
}

describe('library routes (openapi.yaml tag: recordings — listRecordings, getRecording, deleteRecording, retryMergeRecording)', () => {
  let testApp: TestApp;

  afterEach(async () => {
    await stopTestApp(testApp);
  });

  it('listRecordings: a lecturer sees only their own non-deleted rows regardless of a supplied ownerUserId', async () => {
    testApp = await startTestApp();
    seedRecording(testApp, { recordingId: 'r-own', sessionId: 's-own', ownerUserId: testApp.ownerId, startedAt: NOW });
    seedRecording(testApp, { recordingId: 'r-other', sessionId: 's-other', ownerUserId: testApp.otherOwnerId, startedAt: NOW });

    const response = await testApp.app.inject({
      method: 'GET',
      url: `/api/v1/recordings?ownerUserId=${testApp.otherOwnerId}`,
      headers: { authorization: `Bearer ${testApp.ownerToken}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { items: Array<{ id: string; ownerUserId: string }> };
    expect(body.items.map((r) => r.id)).toEqual(['r-own']);
    expect(body.items[0]!.ownerUserId).toBe(testApp.ownerId);
  });

  it('listRecordings: an admin sees all rows and can filter by owner/q/state/includeDeleted', async () => {
    testApp = await startTestApp();
    seedRecording(testApp, { recordingId: 'r-1', sessionId: 's-1', ownerUserId: testApp.ownerId, title: 'Algorithms 101', startedAt: NOW, state: 'ready' });
    seedRecording(testApp, { recordingId: 'r-2', sessionId: 's-2', ownerUserId: testApp.otherOwnerId, title: 'Databases', startedAt: NOW, state: 'failed' });
    seedRecording(testApp, { recordingId: 'r-3', sessionId: 's-3', ownerUserId: testApp.ownerId, title: 'Old lecture', startedAt: NOW, state: 'deleted' });

    const allResponse = await testApp.app.inject({ method: 'GET', url: '/api/v1/recordings', headers: { authorization: `Bearer ${testApp.adminToken}` } });
    const allItems = (allResponse.json() as { items: Array<{ id: string }> }).items;
    expect(allItems.map((r) => r.id).sort()).toEqual(['r-1', 'r-2']); // deleted excluded by default

    const withDeleted = await testApp.app.inject({ method: 'GET', url: '/api/v1/recordings?includeDeleted=true', headers: { authorization: `Bearer ${testApp.adminToken}` } });
    const withDeletedItems = (withDeleted.json() as { items: Array<{ id: string }> }).items;
    expect(withDeletedItems.map((r) => r.id).sort()).toEqual(['r-1', 'r-2', 'r-3']);

    const byOwner = await testApp.app.inject({ method: 'GET', url: `/api/v1/recordings?ownerUserId=${testApp.otherOwnerId}`, headers: { authorization: `Bearer ${testApp.adminToken}` } });
    expect((byOwner.json() as { items: Array<{ id: string }> }).items.map((r) => r.id)).toEqual(['r-2']);

    const byState = await testApp.app.inject({ method: 'GET', url: '/api/v1/recordings?state=failed', headers: { authorization: `Bearer ${testApp.adminToken}` } });
    expect((byState.json() as { items: Array<{ id: string }> }).items.map((r) => r.id)).toEqual(['r-2']);

    const byQ = await testApp.app.inject({ method: 'GET', url: '/api/v1/recordings?q=algo', headers: { authorization: `Bearer ${testApp.adminToken}` } });
    expect((byQ.json() as { items: Array<{ id: string }> }).items.map((r) => r.id)).toEqual(['r-1']);
  });

  it('listRecordings: cursor is a (startedAt, id) keyset — paging never repeats or skips a row', async () => {
    testApp = await startTestApp();
    const times = [0, 1, 2, 3, 4].map((i) => new Date(NOW.getTime() + i * 60_000));
    for (let i = 0; i < 5; i += 1) {
      seedRecording(testApp, { recordingId: `r-${i}`, sessionId: `s-${i}`, ownerUserId: testApp.ownerId, startedAt: times[i]! });
    }

    const collected: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page += 1) {
      const url: string = cursor ? `/api/v1/recordings?limit=2&cursor=${encodeURIComponent(cursor)}` : '/api/v1/recordings?limit=2';
      const response = await testApp.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${testApp.ownerToken}` } });
      const body = response.json() as { items: Array<{ id: string }>; nextCursor: string | null };
      collected.push(...body.items.map((r) => r.id));
      cursor = body.nextCursor;
      if (cursor === null) break;
    }

    expect(collected).toEqual(['r-4', 'r-3', 'r-2', 'r-1', 'r-0']);
  });

  it('getRecording: detail includes ordered segments and files; owner may read their own', async () => {
    testApp = await startTestApp();
    seedRecording(testApp, { recordingId: 'r-1', sessionId: 's-1', ownerUserId: testApp.ownerId, startedAt: NOW });
    testApp.app.db
      .insert(recordingSegments)
      .values([
        { id: 'seg-1', recordingId: 'r-1', index: 1, startedAt: NOW.toISOString(), endedAt: NOW.toISOString(), durationMs: 1000, endReason: 'stop', state: 'finalized' },
        { id: 'seg-0', recordingId: 'r-1', index: 0, startedAt: NOW.toISOString(), endedAt: NOW.toISOString(), durationMs: 1000, endReason: 'pause', state: 'finalized' },
      ])
      .run();
    seedFile(testApp, { fileId: 'f-1', recordingId: 'r-1', path: join(testApp.recordingsRoot, 'sessions', 's-1', 'main.mp4'), bytes: 100 });

    const response = await testApp.app.inject({ method: 'GET', url: '/api/v1/recordings/r-1', headers: { authorization: `Bearer ${testApp.ownerToken}` } });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { segments: Array<{ index: number }>; files: Array<{ id: string; path?: string }> };
    expect(body.segments.map((s) => s.index)).toEqual([0, 1]);
    expect(body.files).toHaveLength(1);
    expect(body.files[0]).not.toHaveProperty('path');
  });

  it('getRecording: a lecturer viewing another owner\'s recording gets 404, not 403', async () => {
    testApp = await startTestApp();
    seedRecording(testApp, { recordingId: 'r-1', sessionId: 's-1', ownerUserId: testApp.otherOwnerId, startedAt: NOW });

    const response = await testApp.app.inject({ method: 'GET', url: '/api/v1/recordings/r-1', headers: { authorization: `Bearer ${testApp.ownerToken}` } });
    expect(response.statusCode).toBe(404);
  });

  it('getRecording: unknown id is 404', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({ method: 'GET', url: '/api/v1/recordings/does-not-exist', headers: { authorization: `Bearer ${testApp.adminToken}` } });
    expect(response.statusCode).toBe(404);
  });

  it('deleteRecording: lecturer forbidden, admin succeeds and audits with a real actor', async () => {
    testApp = await startTestApp();
    seedRecording(testApp, { recordingId: 'r-1', sessionId: 's-1', ownerUserId: testApp.ownerId, startedAt: NOW });
    const filePath = join(testApp.recordingsRoot, 'sessions', 's-1', 'main.mp4');
    seedFile(testApp, { fileId: 'f-1', recordingId: 'r-1', path: filePath, bytes: 100 });

    const forbidden = await testApp.app.inject({ method: 'DELETE', url: '/api/v1/recordings/r-1', headers: { authorization: `Bearer ${testApp.ownerToken}` } });
    expect(forbidden.statusCode).toBe(403);

    const events: RecordingArtifactPayload[] = [];
    testApp.app.bus.subscribe('recording.artifact', (payload) => events.push(payload));

    const response = await testApp.app.inject({ method: 'DELETE', url: '/api/v1/recordings/r-1', headers: { authorization: `Bearer ${testApp.adminToken}` } });
    expect(response.statusCode).toBe(202);

    expect(() => readFileSync(filePath)).toThrow();

    const recordingRow = testApp.app.db.select().from(recordings).where(eq(recordings.id, 'r-1')).get()!;
    expect(recordingRow.state).toBe('deleted');
    expect(recordingRow.deletedBy).toBe(testApp.adminId);
    expect(recordingRow.deleteReason).toBe('admin');

    const sessionRow = testApp.app.db.select().from(lectureSessions).where(eq(lectureSessions.id, 's-1')).get();
    expect(sessionRow).toBeDefined(); // INV-LS-7: the LectureSession survives

    const audit = testApp.app.db.select().from(auditLogEntries).where(eq(auditLogEntries.entityId, 'r-1')).get()!;
    expect(audit.action).toBe('delete');
    expect(audit.actorUserId).toBe(testApp.adminId);

    expect(events.some((e) => e.recordingId === 'r-1' && e.state === 'deleted')).toBe(true);
  });

  it('deleteRecording: unknown id is 404', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({ method: 'DELETE', url: '/api/v1/recordings/does-not-exist', headers: { authorization: `Bearer ${testApp.adminToken}` } });
    expect(response.statusCode).toBe(404);
  });

  it('deleteRecording: cancels a non-terminal upload job, leaves an untouched export_jobs row alone, and is idempotent', async () => {
    testApp = await startTestApp();
    seedRecording(testApp, { recordingId: 'r-1', sessionId: 's-1', ownerUserId: testApp.ownerId, startedAt: NOW });
    testApp.app.db
      .insert(uploadJobs)
      .values({
        id: 'u-1',
        recordingId: 'r-1',
        adapterId: 'placeholder',
        state: 'queued',
        attempt: 0,
        metadata: {},
        enqueuedAt: NOW.toISOString(),
        remoteCleanupState: 'not-needed',
      })
      .run();
    const ownerAuthSession = testApp.app.db.select({ id: authSessions.id }).from(authSessions).where(eq(authSessions.userId, testApp.ownerId)).get()!;
    testApp.app.db
      .insert(exportJobs)
      .values({
        id: 'e-1',
        requestedBy: testApp.ownerId,
        requestedAt: NOW.toISOString(),
        authSessionId: ownerAuthSession.id,
        targetVolume: { devicePath: '/dev/sdb1', mountPath: '/mnt/usb', label: null, capacityBytes: '1000' },
        recordingIds: ['r-1'],
        fileIds: [],
        bytesTotal: 0,
        bytesCopied: 0,
        state: 'copying',
      })
      .run();

    const first = await testApp.app.inject({ method: 'DELETE', url: '/api/v1/recordings/r-1', headers: { authorization: `Bearer ${testApp.adminToken}` } });
    expect(first.statusCode).toBe(202);

    const uploadRow = testApp.app.db.select().from(uploadJobs).where(eq(uploadJobs.id, 'u-1')).get()!;
    expect(uploadRow.state).toBe('cancelled');

    const exportRow = testApp.app.db.select().from(exportJobs).where(eq(exportJobs.id, 'e-1')).get()!;
    expect(exportRow.state).toBe('copying'); // out of this task's scope — left untouched, not corrupted

    const second = await testApp.app.inject({ method: 'DELETE', url: '/api/v1/recordings/r-1', headers: { authorization: `Bearer ${testApp.adminToken}` } });
    expect(second.statusCode).toBe(202);
    const auditCount = testApp.app.db.select().from(auditLogEntries).where(eq(auditLogEntries.entityId, 'r-1')).all().length;
    expect(auditCount).toBe(1); // no duplicate audit row from the idempotent repeat
  });

  it('retryMergeRecording: only accepted for a failed recording; lecturer forbidden', async () => {
    testApp = await startTestApp();
    seedRecording(testApp, { recordingId: 'r-ready', sessionId: 's-ready', ownerUserId: testApp.ownerId, startedAt: NOW, state: 'ready' });
    seedRecording(testApp, { recordingId: 'r-failed', sessionId: 's-failed', ownerUserId: testApp.ownerId, startedAt: NOW, state: 'failed', mergeState: 'failed' });

    const forbidden = await testApp.app.inject({ method: 'POST', url: '/api/v1/recordings/r-failed/retry-merge', headers: { authorization: `Bearer ${testApp.ownerToken}` } });
    expect(forbidden.statusCode).toBe(403);

    const wrongState = await testApp.app.inject({ method: 'POST', url: '/api/v1/recordings/r-ready/retry-merge', headers: { authorization: `Bearer ${testApp.adminToken}` } });
    expect(wrongState.statusCode).toBe(409);

    const accepted = await testApp.app.inject({ method: 'POST', url: '/api/v1/recordings/r-failed/retry-merge', headers: { authorization: `Bearer ${testApp.adminToken}` } });
    expect(accepted.statusCode).toBe(202);
  });
});
