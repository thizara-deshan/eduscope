import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { zDeleteRecordingResponse, zGetRecordingResponse, zListRecordingsResponse, zProblem, zRetryMergeRecordingResponse } from '@eduscope/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { lectureSessions, recordings, users } from '../../src/db/schema.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { FakeClock } from '../fakes/clock.js';
import { FakePipelineManager } from '../fakes/pipeline-manager.js';

const NOW = new Date('2026-07-02T00:00:00.000Z');
const BEARER = 'contract-test-pm-bearer-library';

interface TestApp {
  app: FastifyInstance;
  dir: string;
  pm: FakePipelineManager;
  adminToken: string;
  lecturerToken: string;
  recordingId: string;
}

async function startTestApp(): Promise<TestApp> {
  const dir = mkdtempSync(join(tmpdir(), 'core-api-library-contract-'));
  const pm = new FakePipelineManager({ bearerToken: BEARER });
  const pmBaseUrl = await pm.listen();

  const config = loadConfig({
    NODE_ENV: 'test',
    CORE_API_DB_PATH: join(dir, 'core.db'),
    CORE_API_JWT_SECRET: 'library-contract-secret',
    CORE_API_RECORDINGS_ROOT: join(dir, 'recordings'),
    CORE_API_PM_BASE_URL: pmBaseUrl,
    CORE_API_INTERNAL_BEARER: BEARER,
  });
  const ids = new UlidGenerator();
  const app = await buildApp({ config, clock: new FakeClock(NOW), ids });
  await app.lifecycle.start();

  const adminId = ids.next(NOW);
  const lecturerId = ids.next(NOW);
  await app.db
    .insert(users)
    .values([
      { id: adminId, username: 'admin1', displayName: 'Admin One', role: 'admin', source: 'local', passwordHash: await hashPassword('Password1'), mustResetPassword: false, disabled: false, createdAt: NOW.toISOString() },
      { id: lecturerId, username: 'lecturer1', displayName: 'Lecturer One', role: 'lecturer', source: 'local', passwordHash: await hashPassword('Password1'), mustResetPassword: false, disabled: false, createdAt: NOW.toISOString() },
    ])
    .run();

  const sessionId = ids.next(NOW);
  const recordingId = ids.next(NOW);
  app.db
    .insert(lectureSessions)
    .values({
      id: sessionId,
      title: 'Contract Lecture',
      hallCode: 'HALL-1',
      hallDisplayName: 'Hall 1',
      deviceId: 'device-1',
      ownerUserId: lecturerId,
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
      ownerUserId: lecturerId,
      state: 'ready',
      layoutPresetId: 'pc-only',
      segmentCount: 1,
      mergeState: 'done',
      retentionDeleteAfter: NOW.toISOString(),
      playbackAuthRequired: true,
    })
    .run();

  const adminLogin = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'admin1', password: 'Password1', client: 'panel' } });
  const adminToken = (adminLogin.json() as { tokens: { accessToken: string } }).tokens.accessToken;
  const lecturerLogin = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'lecturer1', password: 'Password1', client: 'panel' } });
  const lecturerToken = (lecturerLogin.json() as { tokens: { accessToken: string } }).tokens.accessToken;

  return { app, dir, pm, adminToken, lecturerToken, recordingId };
}

async function stopTestApp(testApp: TestApp): Promise<void> {
  await testApp.app.close();
  await testApp.pm.close();
  rmSync(testApp.dir, { recursive: true, force: true });
}

describe('library contract (openapi.yaml tag: recordings — listRecordings, getRecording, deleteRecording, retryMergeRecording)', () => {
  let testApp: TestApp;

  afterEach(async () => {
    await stopTestApp(testApp);
  });

  it('listRecordings: 200 parses zListRecordingsResponse', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({ method: 'GET', url: '/api/v1/recordings', headers: { authorization: `Bearer ${testApp.adminToken}` } });
    expect(response.statusCode).toBe(200);
    expect(() => zListRecordingsResponse.parse(response.json())).not.toThrow();
  });

  it('getRecording: 200 parses zGetRecordingResponse', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({ method: 'GET', url: `/api/v1/recordings/${testApp.recordingId}`, headers: { authorization: `Bearer ${testApp.adminToken}` } });
    expect(response.statusCode).toBe(200);
    expect(() => zGetRecordingResponse.parse(response.json())).not.toThrow();
  });

  it('getRecording: 404 parses zProblem', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({ method: 'GET', url: '/api/v1/recordings/does-not-exist', headers: { authorization: `Bearer ${testApp.adminToken}` } });
    expect(response.statusCode).toBe(404);
    expect(() => zProblem.parse(response.json())).not.toThrow();
  });

  it('deleteRecording: 403 parses zProblem for a non-admin', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({ method: 'DELETE', url: `/api/v1/recordings/${testApp.recordingId}`, headers: { authorization: `Bearer ${testApp.lecturerToken}` } });
    expect(response.statusCode).toBe(403);
    expect(() => zProblem.parse(response.json())).not.toThrow();
  });

  it('deleteRecording: 202 parses zDeleteRecordingResponse', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({ method: 'DELETE', url: `/api/v1/recordings/${testApp.recordingId}`, headers: { authorization: `Bearer ${testApp.adminToken}` } });
    expect(response.statusCode).toBe(202);
    expect(() => zDeleteRecordingResponse.parse(response.json())).not.toThrow();
  });

  it('retryMergeRecording: 409 parses zProblem for a non-failed recording', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({ method: 'POST', url: `/api/v1/recordings/${testApp.recordingId}/retry-merge`, headers: { authorization: `Bearer ${testApp.adminToken}` } });
    expect(response.statusCode).toBe(409);
    expect(() => zProblem.parse(response.json())).not.toThrow();
  });

  it('retryMergeRecording: 202 parses zRetryMergeRecordingResponse for a failed recording', async () => {
    testApp = await startTestApp();
    testApp.app.db.update(recordings).set({ state: 'failed', mergeState: 'failed' }).where(eq(recordings.id, testApp.recordingId)).run();
    const response = await testApp.app.inject({ method: 'POST', url: `/api/v1/recordings/${testApp.recordingId}/retry-merge`, headers: { authorization: `Bearer ${testApp.adminToken}` } });
    expect(response.statusCode).toBe(202);
    expect(() => zRetryMergeRecordingResponse.parse(response.json())).not.toThrow();
  });
});
