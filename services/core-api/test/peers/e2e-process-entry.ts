import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { and, eq, inArray } from 'drizzle-orm';
import { answerProjections, auditLogEntries, audioControls, lectureSessions, questions, quizSessionProjections, recordingFiles, recordings, recordingSegments, storageVolumes, uploadFileParts, uploadJobs, users } from '../../src/db/schema.js';
import { SystemClock } from '../../src/lib/clock.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { FakeAiServices } from '../fakes/ai-services.js';
import { FakeBlockDeviceMonitor, type FakeBlockDevice } from '../fakes/block-devices.js';
import { InMemoryHelperTransport } from '../fakes/helper-server.js';
import { FakeMediaTools } from '../fakes/media-tools.js';
import { FakePipelineManager } from '../fakes/pipeline-manager.js';
import { UploadFixtureServer } from '../fakes/upload-fixture-server.js';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`e2e core peer: missing ${name}`);
  return value;
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw.length === 0 ? {} : JSON.parse(raw) as Record<string, unknown>;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function listenControl(
  handler: (action: string, input: unknown) => Promise<unknown>,
): Promise<{ server: Server; url: string }> {
  const server = createServer((request, response) => {
    void (async () => {
      if (request.method !== 'POST' || request.url !== '/control') {
        sendJson(response, 404, { error: 'not-found' });
        return;
      }
      try {
        const body = await readJson(request);
        sendJson(response, 200, await handler(String(body.action ?? ''), body.input));
      } catch (error) {
        sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
      }
    })();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${String(address.port)}/control` };
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'eduscope-e06-core-'));
  const recordingsRoot = join(dir, 'recordings');
  const runtimeDir = join(dir, 'runtime');
  mkdirSync(recordingsRoot, { recursive: true });
  mkdirSync(runtimeDir, { recursive: true });

  const internalBearer = required('E06_INTERNAL_BEARER');
  const quizBaseUrl = required('E06_QUIZ_BASE_URL');
  const quizDeviceId = required('E06_QUIZ_DEVICE_ID');
  const quizDeviceBearer = required('E06_QUIZ_DEVICE_BEARER');
  const provisioningPath = join(dir, 'provisioning.json');
  writeFileSync(provisioningPath, JSON.stringify({
    deviceId: quizDeviceId,
    serialNumber: 'E06-REAL-STACK',
    instituteProfileId: 'integration',
    hallCode: 'E06-HALL',
    hallDisplayName: 'E-06 Hall',
    titlePattern: '{hall} – {date} {time}',
    timezone: 'Asia/Colombo',
    ntpServers: [],
    expectedStorageVolumeUuid: 'e06-recordings',
    featureFlags: { recordingEnabled: true, aiQuizEnabled: true, streamingEnabled: true },
    quizServerBaseUrl: quizBaseUrl,
    // A non-null endpoint so the real question-generation loop actually issues
    // its request (with a null endpoint it short-circuits to `unreachable`
    // without ever calling the question service). The value itself is only
    // forwarded to the fake question service, which ignores it; toggling the
    // fake offline via `core.ai` is what drives the real unreachable/degraded
    // path in the S-13 witness, and `core.ai-generate` queues the drafts that
    // prove recovery.
    llmEndpoint: 'http://127.0.0.1:9/e06-llm',
    provisionedAt: '2026-09-07T00:00:00.000Z',
    provisionedBy: 'e06-real-stack',
  }));

  const pm = new FakePipelineManager({ bearerToken: internalBearer });
  const ai = new FakeAiServices({ bearerToken: internalBearer });
  const upload = new UploadFixtureServer();
  const media = new FakeMediaTools();
  const helper = new InMemoryHelperTransport();
  const usbVolume: FakeBlockDevice = {
    devicePath: '/dev/e06-usb', mountPath: join(dir, 'usb'), label: 'E-06 USB',
    capacityBytes: 4_000_000, freeBytes: 3_000_000, usage: 'removable',
  };
  mkdirSync(usbVolume.mountPath, { recursive: true });
  const usb = new FakeBlockDeviceMonitor([usbVolume]);
  const [pmBaseUrl, aiBaseUrls, uploadBaseUrl] = await Promise.all([
    pm.listen(), ai.listen(), upload.listen(),
  ]);

  const config = loadConfig({
    NODE_ENV: 'test',
    CORE_API_HOST: '127.0.0.1',
    CORE_API_DB_PATH: join(dir, 'core.db'),
    CORE_API_RECORDINGS_ROOT: recordingsRoot,
    CORE_API_RUNTIME_DIR: runtimeDir,
    CORE_API_PROVISIONING_PATH: provisioningPath,
    CORE_API_HELPER_SOCKET: join(dir, 'unused-helper.sock'),
    CORE_API_PM_BASE_URL: pmBaseUrl,
    CORE_API_INTERNAL_BEARER: internalBearer,
    CORE_API_JWT_SECRET: required('E06_JWT_SECRET'),
    CORE_API_SECRETBOX_KEY: required('E06_SECRETBOX_KEY'),
  });

  let app: FastifyInstance | null = null;
  let port = 0;
  let seeded = false;
  let storage = { totalBytes: 1_000_000_000, freeBytes: 800_000_000 };
  let relayFailure = false;
  const relayCalls: unknown[] = [];
  const processEvents: Array<{ consumerId: string; pgid: number | null; state: string }> = [];
  const start = async (): Promise<void> => {
    if (app) return;
    const next = await buildApp({
      config,
      clock: new SystemClock(),
      ids: new UlidGenerator(),
      mediaRunner: media,
      blockDevices: usb as never,
      uploadBaseUrl,
      aiBaseUrls,
      quizServiceBaseUrl: quizBaseUrl,
      quizDeviceBearer,
      helperTransport: helper,
      storageStatfs: async () => storage,
      relay: {
        async activate(streamTargetIds) {
          relayCalls.push({ action: 'activate', streamTargetIds });
          if (relayFailure) throw new Error('relay activation failed');
        },
        async deactivate() {
          relayCalls.push({ action: 'deactivate' });
          if (relayFailure) throw new Error('relay deactivation failed');
        },
      },
    });
    // Test-only CORS: the real Playwright fixture serves the panel bundle
    // and this peer on two different loopback ports, which a browser (unlike
    // Node's own fetch, used by this package's own real-stack tests) refuses
    // to bridge without an explicit allow-origin response. Production panel
    // deployments are same-origin behind a reverse proxy (E-01's committed
    // `apiBaseUrl: "/api/v1"`) and carry no such header.
    next.addHook('onRequest', async (request, reply) => {
      const origin = request.headers.origin;
      if (origin) reply.header('access-control-allow-origin', origin);
      reply.header('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      reply.header('access-control-allow-headers', 'content-type, authorization, range');
      reply.header('access-control-expose-headers', 'content-range, content-length');
      if (request.method === 'OPTIONS') await reply.code(204).send();
    });
    await next.lifecycle.start();
    if (!seeded) {
      const now = new Date().toISOString();
      const ids = new UlidGenerator();
      await next.db.insert(users).values([
        {
          id: ids.next(new Date()), username: 'e06-lecturer', displayName: 'E-06 Lecturer', role: 'lecturer', source: 'local',
          passwordHash: await hashPassword(required('E06_LECTURER_PASSWORD')), mustResetPassword: false, disabled: false, createdAt: now,
        },
        {
          id: ids.next(new Date()), username: 'e06-other', displayName: 'E-06 Other Lecturer', role: 'lecturer', source: 'local',
          passwordHash: await hashPassword(required('E06_OTHER_PASSWORD')), mustResetPassword: false, disabled: false, createdAt: now,
        },
        {
          id: ids.next(new Date()), username: 'e06-admin', displayName: 'E-06 Admin', role: 'admin', source: 'local',
          passwordHash: await hashPassword(required('E06_ADMIN_PASSWORD')), mustResetPassword: false, disabled: false, createdAt: now,
        },
        {
          id: ids.next(new Date()), username: 'e06-reset', displayName: 'E-06 Reset', role: 'lecturer', source: 'local',
          passwordHash: await hashPassword(required('E06_RESET_PASSWORD')), mustResetPassword: true, disabled: false, createdAt: now,
        },
        {
          id: ids.next(new Date()), username: 'e06-disabled', displayName: 'E-06 Disabled', role: 'lecturer', source: 'local',
          passwordHash: await hashPassword(required('E06_DISABLED_PASSWORD')), mustResetPassword: false, disabled: true, createdAt: now,
        },
      ]).run();
      await next.db.insert(storageVolumes).values({
        id: ids.next(new Date()), uuid: 'e06-recordings', devicePath: '/dev/e06-recordings', mountPath: recordingsRoot,
        filesystem: 'ext4', capacityBytes: storage.totalBytes, freeBytes: storage.freeBytes,
        smartStatus: 'good', role: 'recordings', state: 'mounted', registeredAt: now,
      }).run();
      await next.db.insert(audioControls).values({
        roleId: 'mic-lecturer', gain: 50, muted: false, appliedState: 'applied',
        lastAppliedAt: now, lastError: null, updatedBy: null,
      }).run();
      seeded = true;
    }
    const address = await next.listen({ host: '127.0.0.1', port });
    port = Number(new URL(address).port);
    app = next;
  };
  const stop = async (): Promise<void> => {
    const current = app;
    app = null;
    // `lifecycle.stop()` is what actually tears down long-lived state — most
    // relevantly here, `PanelHub.stop()` explicitly closes every open panel
    // WS connection (code 1001). Fastify's own `close()` stops accepting new
    // connections and drains in-flight HTTP requests, but never touches an
    // already-upgraded WebSocket; skipping this left every real-stack
    // `core.stop`/`core.ws.drop` leaving prior panel sockets connected.
    await current?.lifecycle.stop();
    await current?.close();
  };
  await start();

  // Directly seeds a paged, two-owner recordings fixture through the real DB —
  // the same rows `listRecordings` scopes/filters server-side — so the S-21
  // witness can prove real ownership scoping, keyset paging across an HTTP
  // drop, and a title/owner filter applied by the server. Idempotent: it
  // resets its own `e30-` rows first so both real tests in the spec are
  // independent of ordering.
  const seededRecordings = { recordingIds: [] as string[], sessionIds: [] as string[], jobIds: [] as string[] };
  const seedRecordings = (): unknown => {
    const current = app;
    if (!current) throw new Error('core.seed-recordings requires the core service running');
    const db = current.db;
    const lecturer = db.select().from(users).where(eq(users.username, 'e06-lecturer')).get();
    const other = db.select().from(users).where(eq(users.username, 'e06-other')).get();
    if (!lecturer || !other) throw new Error('core.seed-recordings: seeded users are missing');

    // Idempotent reset of exactly the rows a prior seed produced (ids are real
    // ULIDs — the panel's zRecording validates `id`/`sessionId` as ULIDs, so a
    // synthetic prefix would be rejected client-side).
    if (seededRecordings.jobIds.length > 0) db.delete(uploadJobs).where(inArray(uploadJobs.id, seededRecordings.jobIds)).run();
    if (seededRecordings.recordingIds.length > 0) db.delete(recordings).where(inArray(recordings.id, seededRecordings.recordingIds)).run();
    if (seededRecordings.sessionIds.length > 0) db.delete(lectureSessions).where(inArray(lectureSessions.id, seededRecordings.sessionIds)).run();
    seededRecordings.recordingIds = [];
    seededRecordings.sessionIds = [];
    seededRecordings.jobIds = [];

    const ids = new UlidGenerator();
    const base = Date.parse('2026-08-01T09:00:00.000Z');
    // Well in the future so the real retention sweep never removes a seeded row
    // (in particular the one flipped to `done`, which would otherwise become
    // retention-eligible mid-test).
    const retentionDeleteAfter = new Date(Date.now() + 365 * 86_400_000).toISOString();
    const pageSize = 50;
    const lecturerTotal = 55;
    const filterTitle = 'Quantum Cryptography Seminar';
    const otherTitles = ['Other Owner Alpha', 'Other Owner Beta', 'Other Owner Gamma'];

    const insertRecording = (ownerId: string, title: string, startedAt: string): string => {
      const sesId = ids.next(new Date(startedAt));
      const recId = ids.next(new Date(startedAt));
      db.insert(lectureSessions).values({
        id: sesId, title, hallCode: 'E06-HALL', hallDisplayName: 'E-06 Hall', deviceId: 'e30-device',
        ownerUserId: ownerId, startedByActor: 'user', state: 'completed', startedAt, endedAt: startedAt,
        recordedDurationMs: 600_000, pauseCount: 0, channelActivations: [], sourceSnapshot: {}, aiEnabledAtStart: false,
      }).run();
      db.insert(recordings).values({
        id: recId, sessionId: sesId, ownerUserId: ownerId, state: 'ready', layoutPresetId: 'pc-only',
        durationMs: 600_000, totalBytes: 1_000_000, segmentCount: 1, mergeState: 'done',
        retentionDeleteAfter, playbackAuthRequired: true,
      }).run();
      seededRecordings.sessionIds.push(sesId);
      seededRecordings.recordingIds.push(recId);
      return recId;
    };

    let uploadingRecordingId = '';
    for (let i = 0; i < lecturerTotal; i += 1) {
      const startedAt = new Date(base - i * 60_000).toISOString();
      const title = i === 0 ? 'Uploading Lecture' : i === 1 ? filterTitle : `Lecturer Lecture ${String(i)}`;
      const recId = insertRecording(lecturer.id, title, startedAt);
      if (i === 0) uploadingRecordingId = recId;
    }
    otherTitles.forEach((title, j) => {
      insertRecording(other.id, title, new Date(base - (200 + j) * 60_000).toISOString());
    });

    const now = new Date().toISOString();
    const uploadJobId = ids.next(new Date());
    db.insert(uploadJobs).values({
      id: uploadJobId, recordingId: uploadingRecordingId, adapterId: 'placeholder', state: 'uploading', attempt: 1,
      nextAttemptAt: null, lastError: null, lastErrorAt: null, failureClass: null, blockedBy: null, remoteLectureId: null,
      metadata: { title: 'Uploading Lecture' }, enqueuedAt: now, startedAt: now, completedAt: null,
      requeuedBy: null, requeuedAt: null, remoteCleanupState: 'not-needed',
    }).run();
    seededRecordings.jobIds.push(uploadJobId);

    return { lecturerId: lecturer.id, otherId: other.id, pageSize, lecturerTotal, uploadingRecordingId, uploadJobId, otherTitles, filterTitle };
  };

  // Seeds the two S-22 detail fixtures against the real DB and real on-disk
  // media: one `ready` recording with a playable merged file (real
  // authenticated Range/blob transport), and one `failed`-merge recording with
  // a real finalized segment the real merge worker can genuinely re-run
  // (FakeMediaTools' ffmpeg succeeds, so a retry converges to `ready`).
  const seededDetail = { recordingIds: [] as string[], sessionIds: [] as string[] };
  const seedDetail = (): unknown => {
    const current = app;
    if (!current) throw new Error('core.seed-detail requires the core service running');
    const db = current.db;
    const lecturer = db.select().from(users).where(eq(users.username, 'e06-lecturer')).get();
    if (!lecturer) throw new Error('core.seed-detail: seeded lecturer is missing');

    if (seededDetail.recordingIds.length > 0) {
      // The real merge worker (from a prior test's retry) may have created an
      // upload job + parts for a seeded recording; clear parts before the jobs
      // and files they reference so the reset never trips a foreign key.
      const priorJobs = db.select({ id: uploadJobs.id }).from(uploadJobs).where(inArray(uploadJobs.recordingId, seededDetail.recordingIds)).all().map((row) => row.id);
      if (priorJobs.length > 0) db.delete(uploadFileParts).where(inArray(uploadFileParts.uploadJobId, priorJobs)).run();
      db.delete(uploadJobs).where(inArray(uploadJobs.recordingId, seededDetail.recordingIds)).run();
      db.delete(recordingFiles).where(inArray(recordingFiles.recordingId, seededDetail.recordingIds)).run();
      db.delete(recordingSegments).where(inArray(recordingSegments.recordingId, seededDetail.recordingIds)).run();
      db.delete(recordings).where(inArray(recordings.id, seededDetail.recordingIds)).run();
      db.delete(lectureSessions).where(inArray(lectureSessions.id, seededDetail.sessionIds)).run();
    }
    seededDetail.recordingIds = [];
    seededDetail.sessionIds = [];

    const ids = new UlidGenerator();
    // Recent so that when the real merge worker re-runs on the failed recording
    // and recomputes retentionDeleteAfter from the session's endedAt, the new
    // deadline lands in the future — otherwise the retention sweep deletes the
    // just-merged recording.
    const startedAt = new Date(Date.now() - 3_600_000).toISOString();
    const retentionDeleteAfter = new Date(Date.now() + 365 * 86_400_000).toISOString();

    const insertSession = (sesId: string, title: string): void => {
      db.insert(lectureSessions).values({
        id: sesId, title, hallCode: 'E06-HALL', hallDisplayName: 'E-06 Hall', deviceId: 'e31-device',
        ownerUserId: lecturer.id, startedByActor: 'user', state: 'completed', startedAt, endedAt: startedAt,
        recordedDurationMs: 4_000, pauseCount: 0, channelActivations: [], sourceSnapshot: {}, aiEnabledAtStart: false,
      }).run();
      seededDetail.sessionIds.push(sesId);
    };

    // Ready recording with a real merged file on disk.
    const sesA = ids.next(new Date(startedAt));
    const recA = ids.next(new Date(startedAt));
    const fileA = ids.next(new Date(startedAt));
    insertSession(sesA, 'Ready Playback Lecture');
    const mediaPath = join(recordingsRoot, `${recA}-main.mp4`);
    writeFileSync(mediaPath, Buffer.alloc(4_096, 7));
    db.insert(recordings).values({
      id: recA, sessionId: sesA, ownerUserId: lecturer.id, state: 'ready', layoutPresetId: 'pc-only',
      durationMs: 4_000, totalBytes: 4_096, segmentCount: 1, mergeState: 'done',
      retentionDeleteAfter, playbackAuthRequired: true,
    }).run();
    seededDetail.recordingIds.push(recA);
    db.insert(recordingFiles).values({
      id: fileA, recordingId: recA, segmentId: null, kind: 'derived', streamKey: 'main', path: mediaPath,
      container: 'mp4', sizeBytes: 4_096, durationMs: 4_000, checksum: null, state: 'finalized', hasAudio: true, isUploadable: true,
    }).run();

    // Failed-merge recording with a real finalized segment the worker can re-merge.
    const sesB = ids.next(new Date(startedAt));
    const recB = ids.next(new Date(startedAt));
    const segB = ids.next(new Date(startedAt));
    const fileB = ids.next(new Date(startedAt));
    insertSession(sesB, 'Failed Merge Lecture');
    const segmentPath = join(recordingsRoot, `${recB}-seg0.ts`);
    writeFileSync(segmentPath, Buffer.alloc(8_192, 9));
    db.insert(recordings).values({
      id: recB, sessionId: sesB, ownerUserId: lecturer.id, state: 'failed', layoutPresetId: 'pc-only',
      durationMs: null, totalBytes: null, segmentCount: 1, mergeState: 'failed',
      retentionDeleteAfter, playbackAuthRequired: true,
    }).run();
    seededDetail.recordingIds.push(recB);
    db.insert(recordingSegments).values({
      id: segB, recordingId: recB, index: 0, startedAt, endedAt: startedAt, durationMs: 8_000, endReason: 'stop', state: 'finalized',
    }).run();
    db.insert(recordingFiles).values({
      id: fileB, recordingId: recB, segmentId: segB, kind: 'segment', streamKey: 'main', path: segmentPath,
      container: 'mpegts', sizeBytes: 8_192, durationMs: 8_000, checksum: null, state: 'finalized', hasAudio: true, isUploadable: true,
    }).run();

    // Ready recording with an in-flight upload — the S-24 delete confirm shows
    // the differentiated "an upload in progress will be cancelled" warning.
    const sesC = ids.next(new Date(startedAt));
    const recC = ids.next(new Date(startedAt));
    const fileC = ids.next(new Date(startedAt));
    const jobC = ids.next(new Date(startedAt));
    insertSession(sesC, 'Uploading In Flight Lecture');
    const mediaPathC = join(recordingsRoot, `${recC}-main.mp4`);
    writeFileSync(mediaPathC, Buffer.alloc(4_096, 5));
    db.insert(recordings).values({
      id: recC, sessionId: sesC, ownerUserId: lecturer.id, state: 'ready', layoutPresetId: 'pc-only',
      durationMs: 4_000, totalBytes: 4_096, segmentCount: 1, mergeState: 'done',
      retentionDeleteAfter, playbackAuthRequired: true,
    }).run();
    seededDetail.recordingIds.push(recC);
    db.insert(recordingFiles).values({
      id: fileC, recordingId: recC, segmentId: null, kind: 'derived', streamKey: 'main', path: mediaPathC,
      container: 'mp4', sizeBytes: 4_096, durationMs: 4_000, checksum: null, state: 'finalized', hasAudio: true, isUploadable: true,
    }).run();
    db.insert(uploadJobs).values({
      id: jobC, recordingId: recC, adapterId: 'placeholder', state: 'uploading', attempt: 1,
      nextAttemptAt: null, lastError: null, lastErrorAt: null, failureClass: null, blockedBy: null, remoteLectureId: null,
      metadata: { title: 'Uploading In Flight Lecture' }, enqueuedAt: startedAt, startedAt, completedAt: null,
      requeuedBy: null, requeuedAt: null, remoteCleanupState: 'not-needed',
    }).run();

    return { readyRecordingId: recA, readyFileId: fileA, failedRecordingId: recB, inFlightRecordingId: recC };
  };

  // Seeds an S-35 upload fixture: a ready, merge-done recording with a real
  // uploadable file the real upload scheduler will genuinely stream to the
  // upload fixture server. `deadLetter` additionally enqueues it and parks it
  // dead-letter so the requeue path can be driven live.
  const seededUpload = { recordingIds: [] as string[], sessionIds: [] as string[] };
  const seedUpload = (sizeBytes: number, deadLetter: boolean): unknown => {
    const current = app;
    if (!current) throw new Error('core.seed-upload requires the core service running');
    const db = current.db;
    const lecturer = db.select().from(users).where(eq(users.username, 'e06-lecturer')).get();
    if (!lecturer) throw new Error('core.seed-upload: seeded lecturer is missing');

    if (seededUpload.recordingIds.length > 0) {
      const priorJobs = db.select({ id: uploadJobs.id }).from(uploadJobs).where(inArray(uploadJobs.recordingId, seededUpload.recordingIds)).all().map((row) => row.id);
      if (priorJobs.length > 0) db.delete(uploadFileParts).where(inArray(uploadFileParts.uploadJobId, priorJobs)).run();
      db.delete(uploadJobs).where(inArray(uploadJobs.recordingId, seededUpload.recordingIds)).run();
      db.delete(recordingFiles).where(inArray(recordingFiles.recordingId, seededUpload.recordingIds)).run();
      db.delete(recordings).where(inArray(recordings.id, seededUpload.recordingIds)).run();
      db.delete(lectureSessions).where(inArray(lectureSessions.id, seededUpload.sessionIds)).run();
    }
    seededUpload.recordingIds = [];
    seededUpload.sessionIds = [];

    const ids = new UlidGenerator();
    const startedAt = new Date(Date.now() - 3_600_000).toISOString();
    const retentionDeleteAfter = new Date(Date.now() + 365 * 86_400_000).toISOString();
    const sesId = ids.next(new Date(startedAt));
    const recId = ids.next(new Date(startedAt));
    const fileId = ids.next(new Date(startedAt));
    db.insert(lectureSessions).values({
      id: sesId, title: deadLetter ? 'Dead Letter Upload Lecture' : 'Resumable Upload Lecture', hallCode: 'E06-HALL',
      hallDisplayName: 'E-06 Hall', deviceId: 'e34-device', ownerUserId: lecturer.id, startedByActor: 'user',
      state: 'completed', startedAt, endedAt: startedAt, recordedDurationMs: 4_000, pauseCount: 0,
      channelActivations: [], sourceSnapshot: {}, aiEnabledAtStart: false,
    }).run();
    const filePath = join(recordingsRoot, `${recId}-main.mp4`);
    writeFileSync(filePath, Buffer.alloc(sizeBytes, 3));
    db.insert(recordings).values({
      id: recId, sessionId: sesId, ownerUserId: lecturer.id, state: 'ready', layoutPresetId: 'pc-only',
      durationMs: 4_000, totalBytes: sizeBytes, segmentCount: 1, mergeState: 'done',
      retentionDeleteAfter, playbackAuthRequired: true,
    }).run();
    db.insert(recordingFiles).values({
      id: fileId, recordingId: recId, segmentId: null, kind: 'derived', streamKey: 'main', path: filePath,
      container: 'mp4', sizeBytes, durationMs: 4_000, checksum: null, state: 'finalized', hasAudio: true, isUploadable: true,
    }).run();
    seededUpload.sessionIds.push(sesId);
    seededUpload.recordingIds.push(recId);

    let jobId: string | null = null;
    if (deadLetter) {
      // Create the real job + parts through the machine, then park it
      // dead-letter (the scheduler never picks a dead-letter job, so it waits
      // for the manual requeue).
      jobId = current.uploadScheduler.machine.enqueue(recId);
      if (jobId) {
        db.update(uploadJobs).set({ state: 'dead-letter', failureClass: 'permanent', attempt: 2, lastError: 'checksum-mismatch', lastErrorAt: startedAt, nextAttemptAt: null }).where(eq(uploadJobs.id, jobId)).run();
      }
    }
    return { recordingId: recId, sessionId: sesId, fileId, jobId };
  };

  // Seeds an S-30 retention fixture directly against the real DB: an
  // age-expired uploaded recording (deleted by the scheduled/age sweep), an
  // unuploaded recording past the same age deadline (protected forever —
  // `neverDeleteUnuploaded`), two not-yet-age-expired uploaded recordings with
  // distinct session start times (the pressure sweep's uploaded-oldest-first
  // candidates), and one file on disk with no DB row at all (a "foreign" file
  // the sweep never scans for, by construction). Idempotent per-call reset.
  const seededRetention = { recordingIds: [] as string[], sessionIds: [] as string[], jobIds: [] as string[] };
  const seedRetention = (): unknown => {
    const current = app;
    if (!current) throw new Error('core.seed-retention requires the core service running');
    const db = current.db;
    const lecturer = db.select().from(users).where(eq(users.username, 'e06-lecturer')).get();
    if (!lecturer) throw new Error('core.seed-retention: seeded lecturer is missing');

    if (seededRetention.jobIds.length > 0) db.delete(uploadJobs).where(inArray(uploadJobs.id, seededRetention.jobIds)).run();
    if (seededRetention.recordingIds.length > 0) db.delete(recordings).where(inArray(recordings.id, seededRetention.recordingIds)).run();
    if (seededRetention.sessionIds.length > 0) db.delete(lectureSessions).where(inArray(lectureSessions.id, seededRetention.sessionIds)).run();
    seededRetention.recordingIds = [];
    seededRetention.sessionIds = [];
    seededRetention.jobIds = [];

    const ids = new UlidGenerator();
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const farFuture = new Date(Date.now() + 365 * 86_400_000).toISOString();

    const makeRow = (title: string, startedAt: string, retentionDeleteAfter: string, uploaded: boolean): string => {
      const sesId = ids.next(new Date(startedAt));
      const recId = ids.next(new Date(startedAt));
      db.insert(lectureSessions).values({
        id: sesId, title, hallCode: 'E06-HALL', hallDisplayName: 'E-06 Hall', deviceId: 'e37-device',
        ownerUserId: lecturer.id, startedByActor: 'user', state: 'completed', startedAt, endedAt: startedAt,
        recordedDurationMs: 4_000, pauseCount: 0, channelActivations: [], sourceSnapshot: {}, aiEnabledAtStart: false,
      }).run();
      db.insert(recordings).values({
        id: recId, sessionId: sesId, ownerUserId: lecturer.id, state: 'ready', layoutPresetId: 'pc-only',
        durationMs: 4_000, totalBytes: 4_096, segmentCount: 1, mergeState: 'done',
        retentionDeleteAfter, playbackAuthRequired: true,
      }).run();
      seededRetention.sessionIds.push(sesId);
      seededRetention.recordingIds.push(recId);
      if (uploaded) {
        const jobId = ids.next(new Date(startedAt));
        db.insert(uploadJobs).values({
          id: jobId, recordingId: recId, adapterId: 'placeholder', state: 'done', attempt: 1,
          nextAttemptAt: null, lastError: null, lastErrorAt: null, failureClass: null, blockedBy: null, remoteLectureId: null,
          metadata: { title }, enqueuedAt: startedAt, startedAt, completedAt: startedAt,
          requeuedBy: null, requeuedAt: null, remoteCleanupState: 'not-needed',
        }).run();
        seededRetention.jobIds.push(jobId);
      }
      return recId;
    };

    const ageEligibleId = makeRow('E37 Age Eligible', new Date(Date.now() - 5 * 86_400_000).toISOString(), past, true);
    const unuploadedId = makeRow('E37 Unuploaded', new Date(Date.now() - 10 * 86_400_000).toISOString(), past, false);
    const pressureOlderId = makeRow('E37 Pressure Older', new Date(Date.now() - 3 * 86_400_000).toISOString(), farFuture, true);
    const pressureNewerId = makeRow('E37 Pressure Newer', new Date(Date.now() - 1 * 86_400_000).toISOString(), farFuture, true);

    const foreignPath = join(recordingsRoot, 'e37-foreign.bin');
    writeFileSync(foreignPath, Buffer.alloc(2_048, 1));

    return { ageEligibleId, unuploadedId, pressureOlderId, pressureNewerId, foreignPath };
  };

  const control = await listenControl(async (action, input) => {
    const value = input as Record<string, unknown> | undefined;
    switch (action) {
      case 'core.capabilities':
        return { actions: [
          'core.start', 'core.stop', 'core.restart', 'core.ws.drop', 'core.pm.offline', 'core.pm.publish',
          'core.pm.response', 'core.storage-pressure', 'core.ai', 'core.ai-generate', 'core.upload', 'core.helper', 'core.relay', 'core.ledger', 'core.question-audit', 'core.reset-answer-projections',
          'core.seed-recordings', 'core.publish-upload-job', 'core.seed-detail',
          'core.usb.fill', 'core.usb.remove', 'core.usb.restore', 'core.scoped-allows', 'core.delete-audit',
          'core.seed-upload', 'core.upload-enqueue-ready', 'core.upload-audit', 'core.upload-retry-now',
          'core.seed-retention', 'core.retention-sweep', 'core.storage-pressure-step', 'core.mount-scratch-device',
          'core.firmware',
        ] };
      case 'core.seed-retention':
        return seedRetention();
      case 'core.retention-sweep': {
        if (!app) throw new Error('core.retention-sweep requires the core service running');
        const trigger = String(value?.trigger ?? 'scheduled') as 'scheduled' | 'upload' | 'pressure';
        await app.retentionSweep.run(trigger);
        return { ran: trigger };
      }
      case 'core.storage-pressure-step': {
        if (!app) throw new Error('core.storage-pressure-step requires the core service running');
        const criticalStats = value?.critical as { totalBytes: number; freeBytes: number } | undefined;
        const okStats = value?.ok as { totalBytes: number; freeBytes: number } | undefined;
        if (!criticalStats || !okStats) throw new Error('core.storage-pressure-step requires critical and ok stats');
        const relieveAfterCalls = Number(value?.relieveAfterCalls ?? 1);
        let calls = 0;
        app.storageProbe.setStatfs(async () => {
          calls += 1;
          return calls > relieveAfterCalls ? okStats : criticalStats;
        });
        await app.storageProbe.probe();
        return { primed: true };
      }
      case 'core.mount-scratch-device': {
        // Storage volumes have exactly one 'recordings'-role row (schema
        // uniqueness), seeded at boot as uuid `e06-recordings`/devicePath
        // `/dev/e06-recordings` with no matching fake block device — so a
        // real format 422s on device mismatch until a device resolving to
        // that same uuid/devNode is present. This adds exactly that device
        // (distinct from the unrelated `usbVolume` export/USB fixture) so
        // the seeded volume becomes the real, formattable scratch target.
        const uuid = 'e06-recordings';
        const mountPath = join(dir, uuid);
        mkdirSync(mountPath, { recursive: true });
        const scratch: FakeBlockDevice = {
          devicePath: '/dev/e06-recordings', mountPath, label: null,
          capacityBytes: Number(value?.capacityBytes ?? 1_000_000_000), freeBytes: Number(value?.freeBytes ?? 800_000_000), usage: 'recordings',
        };
        usb.setVolumes([usbVolume, scratch]);
        return { uuid, devicePath: scratch.devicePath };
      }
      case 'core.upload-retry-now':
        // Brings a failed job's retry due now (the real connectivity backoff is
        // minutes) and wakes the scheduler — the device coming back online.
        if (!app) throw new Error('core.upload-retry-now requires the core service running');
        app.db.update(uploadJobs).set({ nextAttemptAt: new Date().toISOString() }).where(eq(uploadJobs.recordingId, String(value?.recordingId ?? ''))).run();
        app.uploadScheduler.wake();
        return { woken: true };
      case 'core.seed-upload':
        return seedUpload(Number(value?.sizeBytes ?? 4_096), value?.deadLetter === true);
      case 'core.upload-enqueue-ready':
        // The real finalized-recording trigger the scheduler listens for —
        // enqueues and starts the genuine upload.
        if (!app) throw new Error('core.upload-enqueue-ready requires the core service running');
        app.bus.publish('artifact.ready', { recordingId: String(value?.recordingId ?? ''), sessionId: String(value?.sessionId ?? '') });
        return { published: true };
      case 'core.upload-audit': {
        // The durable upload-job + per-part byte offsets, so a witness can prove
        // a connectivity failure spent no attempt and a restart resumed from a
        // non-zero byte offset (KEEP B-27/B-28).
        if (!app) throw new Error('core.upload-audit requires the core service running');
        const recordingId = String(value?.recordingId ?? '');
        const job = app.db.select().from(uploadJobs).where(eq(uploadJobs.recordingId, recordingId)).get();
        if (!job) return { found: false };
        const parts = app.db.select().from(uploadFileParts).where(eq(uploadFileParts.uploadJobId, job.id)).all();
        return {
          found: true, jobId: job.id, state: job.state, attempt: job.attempt, failureClass: job.failureClass,
          parts: parts.map((part) => ({ state: part.state, bytesSent: Number(part.bytesSent), bytesTotal: Number(part.bytesTotal) })),
        };
      }
      case 'core.delete-audit': {
        // The durable delete-audit row for a recording, resolved to the actor's
        // username — proves KEEP B-33's "audit actor equals the admin", never a
        // system actor, for a manual deletion.
        if (!app) throw new Error('core.delete-audit requires the core service running');
        const recordingId = String(value?.recordingId ?? '');
        const entry = app.db.select().from(auditLogEntries)
          .where(and(eq(auditLogEntries.entityType, 'recording'), eq(auditLogEntries.entityId, recordingId), eq(auditLogEntries.action, 'delete')))
          .get();
        if (!entry) return { found: false };
        const actor = entry.actorUserId ? app.db.select().from(users).where(eq(users.id, entry.actorUserId)).get() : null;
        return { found: true, actorKind: entry.actorKind, actorUserId: entry.actorUserId, actorUsername: actor?.username ?? null, reason: entry.reason };
      }
      case 'core.usb.fill':
        usb.setVolumes([{ ...usbVolume, freeBytes: Number(value?.freeBytes ?? 0) }]);
        return { freeBytes: Number(value?.freeBytes ?? 0) };
      case 'core.usb.remove':
        usb.setVolumes([]);
        return { removed: true };
      case 'core.usb.restore':
        usb.setVolumes([usbVolume]);
        return { restored: true };
      case 'core.scoped-allows': {
        // Reads the real scoped-subscription registry the panel hub gates
        // export.job/usb.volumes delivery on — an authoritative proof that one
        // auth session's export events never reach another (KEEP B-32).
        if (!app) throw new Error('core.scoped-allows requires the core service running');
        const stream = String(value?.stream ?? '') as 'usb.volumes' | 'export.job' | 'log.entry';
        const scope = value?.scope === undefined ? undefined : String(value.scope);
        return { allows: app.scopedSubscriptions.allows(String(value?.authSessionId ?? ''), stream, scope) };
      }
      case 'core.seed-recordings':
        return seedRecordings();
      case 'core.seed-detail':
        return seedDetail();
      case 'core.publish-upload-job': {
        // Re-publishes a seeded upload job at a new state on the SAME real
        // domain bus the upload machine uses, so the panel WS delivers a
        // genuine `upload.job` frame that advances the S-21 badge live.
        if (!app) throw new Error('core.publish-upload-job requires the core service running');
        const jobId = String(value?.jobId ?? '');
        const state = String(value?.state ?? 'done') as 'queued' | 'uploading' | 'completing' | 'done' | 'failed' | 'dead-letter' | 'cancelled';
        const row = app.db.select().from(uploadJobs).where(eq(uploadJobs.id, jobId)).get();
        if (!row) throw new Error(`core.publish-upload-job: unknown job ${jobId}`);
        app.db.update(uploadJobs).set({ state, completedAt: state === 'done' ? new Date().toISOString() : row.completedAt }).where(eq(uploadJobs.id, jobId)).run();
        app.bus.publish('upload.job', {
          jobId: row.id, recordingId: row.recordingId, state, attempt: row.attempt,
          failureClass: null, nextAttemptAt: null, progressPct: state === 'done' ? 100 : 0, lastError: null, blockedBy: null,
        });
        return { published: true, state };
      }
      case 'core.start':
        await start();
        return { running: true };
      case 'core.stop':
        await stop();
        return { running: false };
      case 'core.restart':
      case 'core.ws.drop':
        await stop();
        await start();
        return { running: true };
      case 'core.pm.offline':
        pm.setOffline(value?.offline === true);
        return { offline: value?.offline === true };
      case 'core.pm.publish':
        if (String(value?.event) === 'evt.pm.consumer.running') {
          const data = value?.data as { consumerId?: unknown; pgid?: unknown } | undefined;
          processEvents.push({ consumerId: String(data?.consumerId), pgid: Number(data?.pgid), state: 'running' });
        } else if (String(value?.event) === 'evt.pm.consumer.exited') {
          const data = value?.data as { consumerId?: unknown } | undefined;
          processEvents.push({ consumerId: String(data?.consumerId), pgid: null, state: 'exited' });
        }
        return { sequence: pm.publish(String(value?.event ?? ''), value?.data ?? {}) };
      case 'core.pm.status': {
        const status = value?.status as Parameters<typeof pm.setStatus>[0] | undefined;
        if (!status) throw new Error('core.pm.status requires status');
        pm.setStatus(status);
        pm.forceResyncRequired();
        return { applied: true };
      }
      case 'core.pm.response': {
        const response = { status: Number(value?.status ?? 503), body: value?.body ?? {} };
        const target = String(value?.target ?? '');
        if (target === 'record') pm.queueRecordResponse(response);
        else if (target === 'live') pm.queueLiveResponse(response);
        else if (target === 'meeting') pm.queueMeetingResponse(response);
        else if (target === 'binding') pm.queueBindingResponse(response);
        else if (target === 'audio') pm.queueAudioResponse(response);
        else if (target === 'projector') pm.queueProjectorResponse(response);
        else throw new Error(`unknown PM response target: ${target}`);
        return { queued: target };
      }
      case 'core.storage-pressure':
        storage = { totalBytes: Number(value?.totalBytes), freeBytes: Number(value?.freeBytes) };
        app?.storageProbe.setStatfs(async () => storage);
        await app?.storageProbe.probe();
        return storage;
      case 'core.ai': {
        const service = String(value?.service ?? 'question');
        const offline = value?.offline === true;
        if (service === 'stt') ai.setSttOffline(offline);
        else if (service === 'slide') ai.setSlideOffline(offline);
        else if (service === 'question') ai.setQuestionOffline(offline);
        else throw new Error(`unknown AI service: ${service}`);
        return { service, offline };
      }
      case 'core.ai-generate': {
        // Queues one successful `POST /generate` response (A-14's 3–5 valid
        // MCQ survivors) for the real question-generation loop to consume on
        // the next generate-now, so the S-13 witness can prove genuine
        // recovery to ready drafts after an LLM outage.
        const count = Math.min(5, Math.max(3, Number(value?.count ?? 4)));
        const questions = Array.from({ length: count }, (_, index) => ({
          prompt: `Real generated question ${String(index + 1)}?`,
          options: [
            { text: 'Correct answer', isCorrect: true },
            { text: 'Distractor A', isCorrect: false },
            { text: 'Distractor B', isCorrect: false },
          ],
        }));
        ai.queueGenerateBehaviors([{ kind: 'response', body: {
          questionSetId: 'e06-real-set', promptVersion: 'mcq/v1', modelId: 'e06-llm',
          requested: count, returned: count, droppedInvalid: 0, questions,
        } }]);
        return { queued: count };
      }
      case 'core.upload':
        if (value?.reset === true) upload.resetFaults();
        if (value?.cutAtPatch !== undefined) upload.cutOnPatch(Number(value.cutAtPatch));
        if (value?.failureStatus !== undefined) upload.failNextPatch(Number(value.failureStatus), String(value.error ?? 'failure'));
        return { configured: true };
      case 'core.helper':
        helper.failureVerb = value?.failureVerb === null || value?.failureVerb === undefined ? null : String(value.failureVerb);
        helper.hang = value?.hang === true;
        return { configured: true };
      case 'core.firmware': {
        // Queues the real JSON `detail` payload the real firmware.check/apply
        // helper verbs return on success, matching zFirmwareCheckDetail/
        // zFirmwareApplyDetail — the generic InMemoryHelperTransport's plain
        // 'ok' string is not valid JSON, so a real check/apply outcome
        // (done/bad-signature/boot-failed) needs this to ever resolve.
        if (value?.checkDetail !== undefined) helper.nextDetail['firmware.check'] = JSON.stringify(value.checkDetail);
        if (value?.applyDetail !== undefined) helper.nextDetail['firmware.apply'] = JSON.stringify(value.applyDetail);
        return { configured: true };
      }
      case 'core.relay':
        relayFailure = value?.fail === true;
        return { fail: relayFailure };
      case 'core.ledger':
        return { pm: pm.calls, helper: helper.ledger, relay: relayCalls, ai: {
          stt: ai.sttCalls, slide: ai.slideCalls, question: ai.questionCalls,
        } };
      case 'core.recording-audit':
        return {
          lectureSessions: app?.db.select().from(lectureSessions).all().length ?? 0,
          recordStarts: pm.calls.filter((call) => call.method === 'POST' && call.path === '/consumers/record').length,
        };
      case 'core.process-audit':
        return {
          processEvents,
          recordStarts: pm.calls.filter((call) => call.method === 'POST' && call.path === '/consumers/record').length,
          liveStarts: pm.calls.filter((call) => call.method === 'POST' && call.path === '/consumers/live').length,
          meetingStarts: pm.calls.filter((call) => call.method === 'POST' && call.path === '/consumers/meeting').length,
        };
      case 'core.reset-answer-projections': {
        // Deletes B's replicated answer projections and rewinds its sync
        // watermark to 0, so the next device-sync reconnect makes D replay its
        // authoritative answer history from scratch. Lets an S-19 witness prove
        // B rebuilds a student's projection from D rather than keeping a stale
        // local copy. Reads nothing from D and adds no product route.
        app?.db.delete(answerProjections).run();
        app?.db.update(quizSessionProjections).set({ lastAnswerSeq: 0 }).run();
        return {
          projections: app?.db.select().from(answerProjections).all().length ?? 0,
        };
      }
      case 'core.question-audit': {
        // Every question row with its create-audit actor, so an S-15 witness
        // can prove a lecturer-authored draft carries `lecturer-authored`
        // provenance and a user-actor audit row — and that a server-refused
        // invalid submit left zero rows behind.
        const rows = app?.db.select().from(questions).all() ?? [];
        const audits = (app?.db.select().from(auditLogEntries).all() ?? [])
          .filter((entry) => entry.entityType === 'question' && entry.action === 'create');
        const createByEntity = new Map(audits.map((entry) => [entry.entityId, { actorUserId: entry.actorUserId, actorKind: entry.actorKind }]));
        return { questions: rows.map((row) => ({
          id: row.id, provenance: row.provenance, state: row.state, createdBy: row.createdBy,
          createAudit: createByEntity.get(row.id) ?? null,
        })) };
      }
      case 'core.takeover-audit': {
        const sessions = app?.db.select().from(lectureSessions).all() ?? [];
        return { sessions: sessions.map((session) => ({
          id: session.id, ownerUserId: session.ownerUserId, takeoverBy: session.takeoverBy,
          takeoverAt: session.takeoverAt, state: session.state,
        })) };
      }
      case 'core.transport-audit':
        return { segments: app?.db.select().from(recordingSegments).all().map((segment) => ({
          index: segment.index, state: segment.state, endReason: segment.endReason, durationMs: segment.durationMs,
        })) ?? [] };
      default:
        throw new Error(`unknown core control action: ${action}`);
    }
  });

  process.stdout.write(`${JSON.stringify({
    type: 'ready', service: 'core', baseUrl: `http://127.0.0.1:${String(port)}`, controlUrl: control.url,
    fixtureIds: {
      lecturerUsername: 'e06-lecturer', adminUsername: 'e06-admin',
      resetUsername: 'e06-reset', disabledUsername: 'e06-disabled',
    },
  })}\n`);

  let closing: Promise<void> | null = null;
  const close = (): Promise<void> => closing ??= (async () => {
    await new Promise<void>((resolve) => {
      control.server.close(() => resolve());
      control.server.closeAllConnections();
    });
    await stop();
    await Promise.all([pm.close(), ai.close(), upload.close()]);
    rmSync(dir, { recursive: true, force: true });
  })();
  process.once('SIGTERM', () => void close().then(() => process.exit(0)));
  process.once('SIGINT', () => void close().then(() => process.exit(0)));
}

main().catch((error: unknown) => {
  process.stdout.write(`${JSON.stringify({ type: 'error', message: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
});
