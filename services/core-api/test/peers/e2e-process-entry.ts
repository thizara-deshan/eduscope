import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { eq, inArray } from 'drizzle-orm';
import { answerProjections, auditLogEntries, audioControls, lectureSessions, questions, quizSessionProjections, recordings, recordingSegments, storageVolumes, uploadJobs, users } from '../../src/db/schema.js';
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

  const control = await listenControl(async (action, input) => {
    const value = input as Record<string, unknown> | undefined;
    switch (action) {
      case 'core.capabilities':
        return { actions: [
          'core.start', 'core.stop', 'core.restart', 'core.ws.drop', 'core.pm.offline', 'core.pm.publish',
          'core.pm.response', 'core.storage-pressure', 'core.ai', 'core.ai-generate', 'core.upload', 'core.helper', 'core.relay', 'core.ledger', 'core.question-audit', 'core.reset-answer-projections',
          'core.seed-recordings', 'core.publish-upload-job',
        ] };
      case 'core.seed-recordings':
        return seedRecordings();
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
        if (value?.cutAtPatch !== undefined) upload.cutOnPatch(Number(value.cutAtPatch));
        if (value?.failureStatus !== undefined) upload.failNextPatch(Number(value.failureStatus), String(value.error ?? 'failure'));
        return { configured: true };
      case 'core.helper':
        helper.failureVerb = value?.failureVerb === null || value?.failureVerb === undefined ? null : String(value.failureVerb);
        helper.hang = value?.hang === true;
        return { configured: true };
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
