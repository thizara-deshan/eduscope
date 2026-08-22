import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { auditLogEntries, lectureSessions, recordingFiles, recordings, uploadJobs, users } from '../../src/db/schema.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { FakeClock } from '../fakes/clock.js';
import { FakePipelineManager } from '../fakes/pipeline-manager.js';
import { assertStorageOk } from '../../src/modules/recording/guards.js';

const NOW = new Date('2026-08-19T00:00:00.000Z');
const GIB = 1024 ** 3;
const running: Array<{ app: Awaited<ReturnType<typeof buildApp>>; dir: string; pm: FakePipelineManager }> = [];

async function harness(initial = { totalBytes: 100 * GIB, freeBytes: 30 * GIB }) {
  const dir = mkdtempSync(join(tmpdir(), 'core-retention-'));
  const pm = new FakePipelineManager({ bearerToken: 'retention-bearer' });
  const clock = new FakeClock(NOW);
  const ids = new UlidGenerator();
  let space = initial;
  let probes = 0;
  let stops = 0;
  const app = await buildApp({
    config: loadConfig({ NODE_ENV: 'test', CORE_API_DB_PATH: join(dir, 'core.db'), CORE_API_RECORDINGS_ROOT: join(dir, 'recordings'), CORE_API_PM_BASE_URL: await pm.listen(), CORE_API_INTERNAL_BEARER: 'retention-bearer', CORE_API_JWT_SECRET: 'retention-secret' }),
    clock,
    ids,
    storageStatfs: async () => { probes += 1; return space; },
    storageStopRecording: async () => { stops += 1; },
  });
  await app.lifecycle.start();
  running.push({ app, dir, pm });
  const userId = ids.next(NOW);
  await app.db.insert(users).values({ id: userId, username: 'retention-admin', displayName: 'Retention Admin', role: 'admin', source: 'local', passwordHash: await hashPassword('Password1'), mustResetPassword: false, disabled: false, createdAt: NOW.toISOString() }).run();
  return { app, dir, clock, ids, userId, get probes() { return probes; }, get stops() { return stops; }, setSpace(next: typeof space) { space = next; } };
}

function seedRecording(h: Awaited<ReturnType<typeof harness>>, id: string, ageDays: number, uploadState: 'done' | 'failed') {
  const at = new Date(NOW.getTime() - ageDays * 86_400_000);
  const sessionId = `session-${id}`;
  h.app.db.insert(lectureSessions).values({ id: sessionId, title: id, hallCode: 'H1', hallDisplayName: 'Hall', deviceId: `device-${id}`, ownerUserId: h.userId, startedByActor: 'user', state: 'completed', startedAt: at.toISOString(), endedAt: at.toISOString(), recordedDurationMs: 1_000, pauseCount: 0, channelActivations: [], sourceSnapshot: {}, aiEnabledAtStart: false }).run();
  h.app.db.insert(recordings).values({ id, sessionId, ownerUserId: h.userId, state: 'ready', layoutPresetId: 'pc-only', segmentCount: 1, mergeState: 'done', retentionDeleteAfter: new Date(at.getTime() + 14 * 86_400_000).toISOString(), playbackAuthRequired: true }).run();
  const path = join(h.app.config.recordingsRoot, sessionId, `${id}.mp4`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, id);
  h.app.db.insert(recordingFiles).values({ id: `file-${id}`, recordingId: id, kind: 'derived', streamKey: 'main', path, container: 'mp4', sizeBytes: id.length, durationMs: 1_000, state: 'finalized', hasAudio: true, isUploadable: true }).run();
  h.app.db.insert(uploadJobs).values({ id: `upload-${id}`, recordingId: id, adapterId: 'placeholder', state: uploadState, attempt: 0, metadata: {}, enqueuedAt: at.toISOString(), completedAt: uploadState === 'done' ? at.toISOString() : null, remoteCleanupState: 'not-needed' }).run();
  return path;
}

afterEach(async () => {
  for (const item of running.splice(0)) { await item.app.close(); await item.pm.close(); rmSync(item.dir, { recursive: true, force: true }); }
});

describe('storage pressure and retention (HL-10..HL-14, RET-1..RET-6)', () => {
  it('probes every 60 seconds idle and every 10 seconds while recording', async () => {
    const h = await harness();
    expect(h.probes).toBe(1);
    h.clock.advance(59_999); await Promise.resolve();
    expect(h.probes).toBe(1);
    h.clock.advance(1); await Promise.resolve();
    expect(h.probes).toBe(2);
    h.app.db.insert(lectureSessions).values({ id: 'active', title: 'Active', hallCode: 'H', hallDisplayName: 'Hall', deviceId: 'active-device', ownerUserId: h.userId, startedByActor: 'user', state: 'recording', startedAt: NOW.toISOString(), pauseCount: 0, channelActivations: [], sourceSnapshot: {}, aiEnabledAtStart: false }).run();
    h.clock.advance(10_000); await Promise.resolve();
    expect(h.probes).toBe(3);
  });

  it('applies 5% hysteresis, fails closed, and requests a graceful stop below the 4 GiB floor', async () => {
    const h = await harness({ totalBytes: 100 * GIB, freeBytes: 19 * GIB });
    expect(h.app.storageProbe.snapshot().pressure).toBe('warning');
    h.setSpace({ totalBytes: 100 * GIB, freeBytes: 24 * GIB });
    await h.app.storageProbe.probe();
    expect(h.app.storageProbe.snapshot().pressure).toBe('warning');
    h.setSpace({ totalBytes: 100 * GIB, freeBytes: 26 * GIB });
    await h.app.storageProbe.probe();
    expect(h.app.storageProbe.snapshot().pressure).toBe('ok');
    h.app.storageProbe.setStatfs(async () => { throw new Error('probe failed'); });
    await h.app.storageProbe.probe();
    expect(h.app.storageProbe.snapshot().pressure).toBe('critical');
    expect(() => assertStorageOk(h.app.db)).toThrowError(expect.objectContaining({ status: 422, code: 'storage.critical' }));
    h.app.storageProbe.setStatfs(async () => ({ totalBytes: 100 * GIB, freeBytes: 3 * GIB }));
    await h.app.storageProbe.probe();
    expect(h.stops).toBe(1);
  });

  it('sweeps on upload completion and on the 15-minute fallback cadence', async () => {
    const h = await harness();
    const eventPath = seedRecording(h, 'event-old', 20, 'failed');
    h.app.db.update(uploadJobs).set({ state: 'done', completedAt: NOW.toISOString() }).where(eq(uploadJobs.recordingId, 'event-old')).run();
    h.app.bus.publish('upload.job', { jobId: 'upload-event-old', recordingId: 'event-old', state: 'done', attempt: 0, failureClass: null, nextAttemptAt: null, progressPct: 100, lastError: null, blockedBy: null });
    await Promise.resolve();
    expect(existsSync(eventPath)).toBe(false);

    const timerHarness = await harness();
    const timerPath = seedRecording(timerHarness, 'timer-old', 20, 'done');
    timerHarness.clock.advance(15 * 60_000);
    await Promise.resolve();
    expect(existsSync(timerPath)).toBe(false);
  });

  it('deletes eligible uploaded media through RA-06, never unuploaded media, and ignores foreign files', async () => {
    const h = await harness();
    const uploaded = seedRecording(h, 'uploaded-old', 20, 'done');
    const unuploaded = seedRecording(h, 'unuploaded-old', 20, 'failed');
    const foreign = join(h.app.config.recordingsRoot, 'foreign.bin');
    mkdirSync(dirname(foreign), { recursive: true }); writeFileSync(foreign, 'foreign');
    await h.app.retentionSweep.run('scheduled');
    expect(existsSync(uploaded)).toBe(false);
    expect(existsSync(unuploaded)).toBe(true);
    expect(existsSync(foreign)).toBe(true);
    expect(h.app.db.select().from(recordings).where(eq(recordings.id, 'uploaded-old')).get()).toMatchObject({ state: 'deleted', deleteReason: 'retention', deletedBy: null });
    expect(h.app.db.select().from(auditLogEntries).where(eq(auditLogEntries.entityId, 'uploaded-old')).get()).toMatchObject({ actorKind: 'system', actorUserId: null, reason: 'retention' });
  });

  it('deletes uploaded recordings oldest-first under pressure and mirrors policy in REST/events', async () => {
    const h = await harness({ totalBytes: 100 * GIB, freeBytes: 10 * GIB });
    seedRecording(h, 'oldest', 10, 'done');
    seedRecording(h, 'newest', 2, 'done');
    const order: string[] = [];
    const statuses: Array<{ policy: { warningThresholdPct: number } }> = [];
    h.app.bus.subscribe('recording.artifact', (event) => { if (event.state === 'deleted') order.push(event.recordingId); });
    h.app.bus.subscribe('storage.status', (event) => { statuses.push(event); });
    let free = 10 * GIB;
    h.app.storageProbe.setStatfs(async () => ({ totalBytes: 100 * GIB, freeBytes: free += 12 * GIB }));
    await h.app.retentionSweep.run('pressure');
    expect(order[0]).toBe('oldest');
    expect(statuses.at(-1)).toMatchObject({ policy: { warningThresholdPct: 80 } });
    const login = await h.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'retention-admin', password: 'Password1', client: 'admin' } });
    const token = (login.json() as { tokens: { accessToken: string } }).tokens.accessToken;
    const response = await h.app.inject({ method: 'GET', url: '/api/v1/storage', headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ policy: { maxAgeDays: 14, earlyDeleteOrder: 'uploaded-oldest-first', neverDeleteUnuploaded: true, refuseStartWhenCritical: true } });
  });
});
