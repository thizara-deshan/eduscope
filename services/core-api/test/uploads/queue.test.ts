import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { lectureSessions, recordingFiles, recordings, systemAlerts, uploadFileParts, uploadJobs, users } from '../../src/db/schema.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { retryDelayMs } from '../../src/modules/uploads/machine.js';
import type { UploadAdapter } from '../../src/modules/uploads/scheduler.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { FakeClock } from '../fakes/clock.js';
import { FakePipelineManager } from '../fakes/pipeline-manager.js';

const NOW = new Date('2026-07-08T00:00:00.000Z');
const running: Array<{ app: Awaited<ReturnType<typeof buildApp>>; dir: string; pm: FakePipelineManager }> = [];

class FakeUploadAdapter implements UploadAdapter {
  readonly id = 'fake';
  attempts = 0;
  active = 0;
  maxActive = 0;
  uploaded: string[] = [];
  failure: { failureClass: 'connectivity' | 'server' | 'permanent'; message: string } | undefined;

  async createLecture(): Promise<{ remoteLectureId: string }> { return { remoteLectureId: 'lecture-1' }; }
  async uploadPart(input: { part: { recordingFileId: string; bytesTotal: number }; stream: Readable; onCheckpoint: (checkpoint: { bytesSent: number; resumeToken: string | null; remoteFileId: string | null }) => void }): Promise<{ remoteFileId: string; checksum: string | null }> {
    this.attempts += 1;
    if (this.failure) throw Object.assign(new Error(this.failure.message), { failureClass: this.failure.failureClass });
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    let sent = 0;
    for await (const chunk of input.stream) {
      sent += Buffer.byteLength(chunk as Buffer);
      input.onCheckpoint({ bytesSent: sent, resumeToken: `at:${sent}`, remoteFileId: `remote-${input.part.recordingFileId}` });
    }
    this.active -= 1;
    this.uploaded.push(input.part.recordingFileId);
    return { remoteFileId: `remote-${input.part.recordingFileId}`, checksum: 'sha256:test' };
  }
  async completeLecture(): Promise<void> {}
  async deleteLecture(): Promise<void> {}
}

async function eventually<T>(read: () => T | undefined): Promise<T> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('timed out waiting for upload scheduler');
}

async function harness(adapter = new FakeUploadAdapter()) {
  const dir = mkdtempSync(join(tmpdir(), 'core-upload-'));
  const pm = new FakePipelineManager({ bearerToken: 'upload-bearer' });
  const ids = new UlidGenerator();
  const clock = new FakeClock(NOW);
  const config = loadConfig({ NODE_ENV: 'test', CORE_API_DB_PATH: join(dir, 'core.db'), CORE_API_RECORDINGS_ROOT: join(dir, 'recordings'), CORE_API_PM_BASE_URL: await pm.listen(), CORE_API_INTERNAL_BEARER: 'upload-bearer', CORE_API_JWT_SECRET: 'upload-secret' });
  const app = await buildApp({ config, clock, ids, uploadAdapter: adapter });
  await app.lifecycle.start();
  running.push({ app, dir, pm });
  const userId = ids.next(NOW);
  const sessionId = ids.next(NOW);
  const recordingId = ids.next(NOW);
  await app.db.insert(users).values({ id: userId, username: 'upload-admin', displayName: 'Upload Admin', role: 'admin', source: 'local', passwordHash: await hashPassword('Password1'), mustResetPassword: false, disabled: false, createdAt: NOW.toISOString() }).run();
  app.db.insert(lectureSessions).values({ id: sessionId, title: 'Upload lecture', hallCode: 'H-1', hallDisplayName: 'Hall 1', deviceId: 'device-1', ownerUserId: userId, startedByActor: 'user', state: 'completed', startedAt: NOW.toISOString(), endedAt: NOW.toISOString(), recordedDurationMs: 60_000, pauseCount: 0, channelActivations: [], sourceSnapshot: {}, aiEnabledAtStart: false }).run();
  app.db.insert(recordings).values({ id: recordingId, sessionId, ownerUserId: userId, state: 'ready', layoutPresetId: 'pc-only', segmentCount: 1, mergeState: 'done', retentionDeleteAfter: NOW.toISOString(), playbackAuthRequired: true }).run();
  const fileIds: string[] = [];
  for (const streamKey of ['main', 'slides']) {
    const fileId = ids.next(NOW);
    const path = join(config.recordingsRoot, sessionId, `${streamKey}.mp4`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, Buffer.alloc(100, streamKey === 'main' ? 1 : 2));
    app.db.insert(recordingFiles).values({ id: fileId, recordingId, streamKey, kind: 'merged', path, container: 'mp4', sizeBytes: 100, durationMs: 60_000, checksum: null, state: 'finalized', hasAudio: streamKey === 'main', isUploadable: true }).run();
    fileIds.push(fileId);
  }
  return { app, adapter, clock, ids, userId, sessionId, recordingId, fileIds };
}

afterEach(async () => {
  for (const item of running.splice(0)) {
    await item.app.close();
    await item.pm.close();
    rmSync(item.dir, { recursive: true, force: true });
  }
});

describe('upload queue machine 3a/3b', () => {
  it('creates exactly one immediate job and one part per uploadable file, then transfers serially with checkpoints', async () => {
    const h = await harness();
    h.app.bus.publish('artifact.ready', { recordingId: h.recordingId, sessionId: h.sessionId });
    h.app.bus.publish('artifact.ready', { recordingId: h.recordingId, sessionId: h.sessionId });
    const done = await eventually(() => h.app.db.select().from(uploadJobs).all().find((row) => row.state === 'done'));
    expect(done.attempt).toBe(0);
    expect(h.app.db.select().from(uploadJobs).all()).toHaveLength(1);
    const parts = h.app.db.select().from(uploadFileParts).all();
    expect(parts).toHaveLength(2);
    expect(parts.every((part) => part.state === 'uploaded' && part.bytesSent === 100)).toBe(true);
    expect(h.adapter.uploaded).toEqual(h.fileIds);
    expect(h.adapter.maxActive).toBe(1);
  });

  it('does not enqueue before artifact.ready and dead-letters a missing local part immediately', async () => {
    const h = await harness();
    expect(h.app.db.select().from(uploadJobs).all()).toHaveLength(0);
    rmSync(join(h.app.config.recordingsRoot, h.sessionId, 'main.mp4'));
    h.app.bus.publish('artifact.ready', { recordingId: h.recordingId, sessionId: h.sessionId });
    const dead = await eventually(() => h.app.db.select().from(uploadJobs).all().find((row) => row.state === 'dead-letter'));
    expect(dead.failureClass).toBe('permanent');
    expect(dead.attempt).toBe(0);
  });

  it('uses the specified retry ladder with injectable ±20% jitter', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map((attempt) => retryDelayMs(attempt, () => 0.5))).toEqual([30_000, 120_000, 480_000, 1_800_000, 7_200_000, 21_600_000, 21_600_000, 21_600_000, 21_600_000]);
    expect(retryDelayMs(1, () => 0)).toBe(24_000);
    expect(retryDelayMs(1, () => 1)).toBe(36_000);
  });

  it.each([
    ['connectivity', 0, 'failed'],
    ['server', 1, 'failed'],
    ['permanent', 1, 'failed'],
  ] as const)('persists typed %s failures without parsing lastError', async (failureClass, attempt, state) => {
    const adapter = new FakeUploadAdapter();
    adapter.failure = { failureClass, message: 'opaque identical message' };
    const h = await harness(adapter);
    h.app.bus.publish('artifact.ready', { recordingId: h.recordingId, sessionId: h.sessionId });
    const failed = await eventually(() => h.app.db.select().from(uploadJobs).all().find((row) => row.state === state));
    expect(failed.failureClass).toBe(failureClass);
    expect(failed.attempt).toBe(attempt);
    if (failureClass === 'connectivity') expect(adapter.attempts).toBe(1);
  });

  it('dead-letters permanent failures after 2 and server failures after 8', async () => {
    const permanent = await harness();
    const permanentId = permanent.app.uploadScheduler.machine.enqueue(permanent.recordingId)!;
    permanent.app.uploadScheduler.machine.fail(permanentId, 'permanent', 'same');
    expect(permanent.app.db.select().from(uploadJobs).all()[0]!.state).toBe('failed');
    permanent.app.uploadScheduler.machine.fail(permanentId, 'permanent', 'same');
    expect(permanent.app.db.select().from(uploadJobs).all()[0]!.state).toBe('dead-letter');

    const server = await harness();
    const serverId = server.app.uploadScheduler.machine.enqueue(server.recordingId)!;
    for (let attempt = 1; attempt <= 8; attempt += 1) server.app.uploadScheduler.machine.fail(serverId, 'server', 'same');
    const row = server.app.db.select().from(uploadJobs).all()[0]!;
    expect(row).toMatchObject({ state: 'dead-letter', attempt: 8, failureClass: 'server' });
  });

  it('raises the 24-hour offline alert, observes deletion cancellation, and recovers interrupted rows', async () => {
    const h = await harness();
    const jobId = h.app.uploadScheduler.machine.enqueue(h.recordingId)!;
    h.app.uploadScheduler.machine.fail(jobId, 'connectivity', 'offline');
    h.app.db.update(uploadJobs).set({ lastErrorAt: new Date(NOW.getTime() - 86_400_001).toISOString() }).run();
    h.app.uploadScheduler.machine.ensureOfflineAlert();
    expect(h.app.db.select().from(systemAlerts).all()).toHaveLength(1);
    h.app.db.update(uploadJobs).set({ state: 'uploading' }).run();
    h.app.db.update(uploadFileParts).set({ state: 'uploading' }).run();
    h.app.uploadScheduler.machine.recoverInterrupted();
    expect(h.app.db.select().from(uploadJobs).all()[0]!.state).toBe('queued');
    expect(h.app.db.select().from(uploadFileParts).all().every((part) => part.state === 'pending')).toBe(true);
    h.app.uploadScheduler.machine.cancelDeleted(h.recordingId);
    expect(h.app.db.select().from(uploadJobs).all()[0]!.state).toBe('cancelled');
    expect(h.app.db.select().from(uploadJobs).all()).toHaveLength(1);
  });

  it('guards manual requeue and resets a dead-letter job without duplicating it', async () => {
    const h = await harness();
    const jobId = h.app.uploadScheduler.machine.enqueue(h.recordingId)!;
    h.app.uploadScheduler.machine.fail(jobId, 'permanent', 'bad');
    h.app.uploadScheduler.machine.fail(jobId, 'permanent', 'bad');
    const lecturer = { userId: h.userId, authSessionId: 'session', role: 'lecturer' as const, mustResetPassword: false };
    expect(() => h.app.uploadScheduler.machine.requeue(lecturer, jobId)).toThrowError('Administrator role required');
    const admin = { ...lecturer, role: 'admin' as const };
    expect(h.app.uploadScheduler.machine.requeue(admin, jobId)).toMatchObject({ resolveBySec: 5 });
    const row = h.app.db.select().from(uploadJobs).all()[0]!;
    expect(row).toMatchObject({ state: 'queued', attempt: 0, lastError: null, failureClass: null, requeuedBy: h.userId });
    expect(h.app.db.select().from(uploadJobs).all()).toHaveLength(1);
  });
});
