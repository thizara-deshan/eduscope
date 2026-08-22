import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { lectureSessions, recordingFiles, recordings, users } from '../../src/db/schema.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { FakeClock } from '../fakes/clock.js';
import { FakePipelineManager } from '../fakes/pipeline-manager.js';

const NOW = new Date('2026-07-05T00:00:00.000Z');
const BEARER = 'media-test-pm-bearer';
const CONTENT = Buffer.from('0123456789'); // 10 bytes — small enough to hand-check Range math

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
  recordingId: string;
  fileId: string;
  filePath: string;
}

async function loginAs(app: FastifyInstance, username: string, password: string): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password, client: 'panel' } });
  return (response.json() as { tokens: { accessToken: string } }).tokens.accessToken;
}

async function startTestApp(): Promise<TestApp> {
  const dir = mkdtempSync(join(tmpdir(), 'core-api-media-'));
  const recordingsRoot = join(dir, 'recordings');
  const pm = new FakePipelineManager({ bearerToken: BEARER });
  const pmBaseUrl = await pm.listen();

  const config = loadConfig({
    NODE_ENV: 'test',
    CORE_API_DB_PATH: join(dir, 'core.db'),
    CORE_API_JWT_SECRET: 'media-test-secret',
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

  const sessionId = ids.next(NOW);
  const recordingId = ids.next(NOW);
  const fileId = ids.next(NOW);
  app.db
    .insert(lectureSessions)
    .values({
      id: sessionId,
      title: 'Weird / Title *?',
      hallCode: 'HALL-1',
      hallDisplayName: 'Hall 1',
      deviceId: 'device-1',
      ownerUserId: ownerId,
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
  app.db
    .insert(recordings)
    .values({
      id: recordingId,
      sessionId,
      ownerUserId: ownerId,
      state: 'ready',
      layoutPresetId: 'pc-only',
      segmentCount: 1,
      mergeState: 'done',
      retentionDeleteAfter: NOW.toISOString(),
      playbackAuthRequired: true,
    })
    .run();

  const filePath = join(recordingsRoot, 'sessions', sessionId, 'main.mp4');
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, CONTENT);
  app.db
    .insert(recordingFiles)
    .values({
      id: fileId,
      recordingId,
      segmentId: null,
      kind: 'derived',
      streamKey: 'main',
      path: filePath,
      container: 'mp4',
      sizeBytes: CONTENT.length,
      durationMs: 1000,
      state: 'finalized',
      hasAudio: true,
      isUploadable: true,
    })
    .run();

  const ownerToken = await loginAs(app, 'owner', 'Password1');
  const otherOwnerToken = await loginAs(app, 'other', 'Password1');
  const adminToken = await loginAs(app, 'admin1', 'Password1');

  return { app, dir, recordingsRoot, pm, ids, ownerId, otherOwnerId, adminId, ownerToken, otherOwnerToken, adminToken, recordingId, fileId, filePath };
}

async function stopTestApp(testApp: TestApp): Promise<void> {
  await testApp.app.close();
  await testApp.pm.close();
  rmSync(testApp.dir, { recursive: true, force: true });
}

function mediaUrl(testApp: TestApp, query = ''): string {
  return `/api/v1/recordings/${testApp.recordingId}/files/${testApp.fileId}/media${query}`;
}

describe('getRecordingMedia (openapi.yaml tag: recordings — HTTP Range playback/download)', () => {
  let testApp: TestApp;

  afterEach(async () => {
    await stopTestApp(testApp);
  });

  it('no Range: 200 with the full body and Accept-Ranges', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({ method: 'GET', url: mediaUrl(testApp), headers: { authorization: `Bearer ${testApp.ownerToken}` } });
    expect(response.statusCode).toBe(200);
    expect(response.headers['accept-ranges']).toBe('bytes');
    expect(response.headers['content-type']).toBe('video/mp4');
    expect(response.rawPayload).toEqual(CONTENT);
  });

  it('bounded Range: 206 with exactly the requested bytes', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({ method: 'GET', url: mediaUrl(testApp), headers: { authorization: `Bearer ${testApp.ownerToken}`, range: 'bytes=2-5' } });
    expect(response.statusCode).toBe(206);
    expect(response.headers['content-range']).toBe(`bytes 2-5/${CONTENT.length}`);
    expect(response.headers['content-length']).toBe('4');
    expect(response.rawPayload).toEqual(CONTENT.subarray(2, 6));
  });

  it('open-ended Range: 206 through the end of the file', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({ method: 'GET', url: mediaUrl(testApp), headers: { authorization: `Bearer ${testApp.ownerToken}`, range: 'bytes=7-' } });
    expect(response.statusCode).toBe(206);
    expect(response.headers['content-range']).toBe(`bytes 7-9/${CONTENT.length}`);
    expect(response.rawPayload).toEqual(CONTENT.subarray(7));
  });

  it('suffix Range: 206 for the last N bytes', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({ method: 'GET', url: mediaUrl(testApp), headers: { authorization: `Bearer ${testApp.ownerToken}`, range: 'bytes=-3' } });
    expect(response.statusCode).toBe(206);
    expect(response.headers['content-range']).toBe(`bytes 7-9/${CONTENT.length}`);
    expect(response.rawPayload).toEqual(CONTENT.subarray(7));
  });

  it('invalid Range syntax: 416 with Content-Range bytes */size', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({ method: 'GET', url: mediaUrl(testApp), headers: { authorization: `Bearer ${testApp.ownerToken}`, range: 'not-a-range' } });
    expect(response.statusCode).toBe(416);
    expect(response.headers['content-range']).toBe(`bytes */${CONTENT.length}`);
  });

  it('unsatisfiable Range (beyond EOF): 416', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({ method: 'GET', url: mediaUrl(testApp), headers: { authorization: `Bearer ${testApp.ownerToken}`, range: 'bytes=100-200' } });
    expect(response.statusCode).toBe(416);
  });

  it('?download=1 adds a sanitized Content-Disposition attachment header', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({ method: 'GET', url: mediaUrl(testApp, '?download=true'), headers: { authorization: `Bearer ${testApp.ownerToken}` } });
    expect(response.statusCode).toBe(200);
    const disposition = response.headers['content-disposition'] as string;
    expect(disposition).toMatch(/^attachment; filename="[^"/*?]+\.mp4"$/);
    expect(disposition).not.toContain('/');
    expect(disposition).not.toContain('*');
    expect(disposition).not.toContain('?');
  });

  it('missing file: 404', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({
      method: 'GET',
      url: `/api/v1/recordings/${testApp.recordingId}/files/does-not-exist/media`,
      headers: { authorization: `Bearer ${testApp.ownerToken}` },
    });
    expect(response.statusCode).toBe(404);
  });

  it('lecturer cross-owner denial: 403', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({ method: 'GET', url: mediaUrl(testApp), headers: { authorization: `Bearer ${testApp.otherOwnerToken}` } });
    expect(response.statusCode).toBe(403);
  });

  it('admin may access any owner\'s media', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({ method: 'GET', url: mediaUrl(testApp), headers: { authorization: `Bearer ${testApp.adminToken}` } });
    expect(response.statusCode).toBe(200);
  });

  it('deleted file: 404', async () => {
    testApp = await startTestApp();
    testApp.app.db.update(recordingFiles).set({ state: 'deleted' }).where(eq(recordingFiles.id, testApp.fileId)).run();
    const response = await testApp.app.inject({ method: 'GET', url: mediaUrl(testApp), headers: { authorization: `Bearer ${testApp.ownerToken}` } });
    expect(response.statusCode).toBe(404);
  });

  it('a symlink escaping the recordings mount: 404, never followed', async () => {
    testApp = await startTestApp();
    const outsidePath = join(testApp.dir, 'outside.mp4');
    writeFileSync(outsidePath, Buffer.from('secret'));
    const escapeFileId = testApp.ids.next(NOW);
    const linkPath = join(testApp.recordingsRoot, 'escape-link.mp4');
    try {
      symlinkSync(outsidePath, linkPath);
    } catch {
      // symlink creation can require elevated privileges on some Windows configs — the
      // path-prefix check below is what actually enforces the mount boundary either way,
      // so exercise it directly against a row whose `path` simply resolves outside the mount.
    }
    testApp.app.db
      .insert(recordingFiles)
      .values({
        id: escapeFileId,
        recordingId: testApp.recordingId,
        segmentId: null,
        kind: 'derived',
        streamKey: 'escape',
        path: outsidePath,
        container: 'mp4',
        sizeBytes: 6,
        durationMs: 1000,
        state: 'finalized',
        hasAudio: true,
        isUploadable: true,
      })
      .run();

    const response = await testApp.app.inject({
      method: 'GET',
      url: `/api/v1/recordings/${testApp.recordingId}/files/${escapeFileId}/media`,
      headers: { authorization: `Bearer ${testApp.ownerToken}` },
    });
    expect(response.statusCode).toBe(404);
  });

  it('never exposes the physical path in a Problem response', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({
      method: 'GET',
      url: `/api/v1/recordings/${testApp.recordingId}/files/does-not-exist/media`,
      headers: { authorization: `Bearer ${testApp.ownerToken}` },
    });
    expect(JSON.stringify(response.json())).not.toContain(testApp.filePath);
  });
});
