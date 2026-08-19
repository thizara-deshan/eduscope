import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { zProblem } from '@eduscope/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { lectureSessions, recordingFiles, recordings, users } from '../../src/db/schema.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { FakeClock } from '../fakes/clock.js';
import { FakePipelineManager } from '../fakes/pipeline-manager.js';

const NOW = new Date('2026-07-06T00:00:00.000Z');
const BEARER = 'contract-test-pm-bearer-media';
const CONTENT = Buffer.from('contract-media-bytes');

interface TestApp {
  app: FastifyInstance;
  dir: string;
  pm: FakePipelineManager;
  token: string;
  recordingId: string;
  fileId: string;
}

async function startTestApp(): Promise<TestApp> {
  const dir = mkdtempSync(join(tmpdir(), 'core-api-media-contract-'));
  const recordingsRoot = join(dir, 'recordings');
  const pm = new FakePipelineManager({ bearerToken: BEARER });
  const pmBaseUrl = await pm.listen();

  const config = loadConfig({
    NODE_ENV: 'test',
    CORE_API_DB_PATH: join(dir, 'core.db'),
    CORE_API_JWT_SECRET: 'media-contract-secret',
    CORE_API_RECORDINGS_ROOT: recordingsRoot,
    CORE_API_PM_BASE_URL: pmBaseUrl,
    CORE_API_INTERNAL_BEARER: BEARER,
  });
  const ids = new UlidGenerator();
  const app = await buildApp({ config, clock: new FakeClock(NOW), ids });
  await app.lifecycle.start();

  const userId = ids.next(NOW);
  await app.db
    .insert(users)
    .values({ id: userId, username: 'lecturer1', displayName: 'Lecturer One', role: 'lecturer', source: 'local', passwordHash: await hashPassword('Password1'), mustResetPassword: false, disabled: false, createdAt: NOW.toISOString() })
    .run();

  const sessionId = ids.next(NOW);
  const recordingId = ids.next(NOW);
  const fileId = ids.next(NOW);
  app.db
    .insert(lectureSessions)
    .values({
      id: sessionId,
      title: 'Contract Lecture',
      hallCode: 'HALL-1',
      hallDisplayName: 'Hall 1',
      deviceId: 'device-1',
      ownerUserId: userId,
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
      ownerUserId: userId,
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

  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'lecturer1', password: 'Password1', client: 'panel' } });
  const token = (login.json() as { tokens: { accessToken: string } }).tokens.accessToken;

  return { app, dir, pm, token, recordingId, fileId };
}

async function stopTestApp(testApp: TestApp): Promise<void> {
  await testApp.app.close();
  await testApp.pm.close();
  rmSync(testApp.dir, { recursive: true, force: true });
}

describe('getRecordingMedia contract (openapi.yaml tag: recordings)', () => {
  let testApp: TestApp;

  afterEach(async () => {
    await stopTestApp(testApp);
  });

  it('200: video/mp4 content type, Accept-Ranges present', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({
      method: 'GET',
      url: `/api/v1/recordings/${testApp.recordingId}/files/${testApp.fileId}/media`,
      headers: { authorization: `Bearer ${testApp.token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('video/mp4');
    expect(response.headers['accept-ranges']).toBe('bytes');
  });

  it('206: partial content for a Range request', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({
      method: 'GET',
      url: `/api/v1/recordings/${testApp.recordingId}/files/${testApp.fileId}/media`,
      headers: { authorization: `Bearer ${testApp.token}`, range: 'bytes=0-3' },
    });
    expect(response.statusCode).toBe(206);
    expect(response.headers['content-range']).toBeTruthy();
  });

  it('403 parses zProblem for a non-owner', async () => {
    testApp = await startTestApp();
    const otherId = new UlidGenerator().next(NOW);
    await testApp.app.db
      .insert(users)
      .values({ id: otherId, username: 'other1', displayName: 'Other', role: 'lecturer', source: 'local', passwordHash: await hashPassword('Password1'), mustResetPassword: false, disabled: false, createdAt: NOW.toISOString() })
      .run();
    const login = await testApp.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'other1', password: 'Password1', client: 'panel' } });
    const otherToken = (login.json() as { tokens: { accessToken: string } }).tokens.accessToken;

    const response = await testApp.app.inject({
      method: 'GET',
      url: `/api/v1/recordings/${testApp.recordingId}/files/${testApp.fileId}/media`,
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(response.statusCode).toBe(403);
    expect(() => zProblem.parse(response.json())).not.toThrow();
  });

  it('404 parses zProblem for an unknown file', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({
      method: 'GET',
      url: `/api/v1/recordings/${testApp.recordingId}/files/does-not-exist/media`,
      headers: { authorization: `Bearer ${testApp.token}` },
    });
    expect(response.statusCode).toBe(404);
    expect(() => zProblem.parse(response.json())).not.toThrow();
  });
});
