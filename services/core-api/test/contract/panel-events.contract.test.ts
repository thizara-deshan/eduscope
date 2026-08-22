import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { FastifyInstance } from 'fastify';
import { PANEL_EVENT_NAMES, type EventEnvelope, type PanelEventName } from '@eduscope/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { users } from '../../src/db/schema.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { FakeClock } from '../fakes/clock.js';
import { FakePipelineManager } from '../fakes/pipeline-manager.js';

const NOW = new Date('2026-08-20T00:00:00.000Z');
const BEARER = 'panel-events-contract-pm-bearer';
const AT = NOW.toISOString();

const ulid = new UlidGenerator();
const id = (): string => ulid.next(NOW);

/**
 * One contract-valid sample payload per `PANEL_EVENT_NAMES` member (B-35 step 4:
 * "every PANEL_EVENT_NAMES member serializes"). This is B-35's own ownership
 * boundary — the fan-out mechanism, not each event's producer — so samples are
 * hand-built to the exact events.md §2 shape rather than driven through every
 * owning module's full business flow (that end-to-end drive is B-38's job).
 */
const SAMPLES: Record<PanelEventName, unknown> = {
  'recording.state': {
    state: 'recording', startReason: 'initial', sessionId: id(), title: 'Lecture', ownerUserId: id(), ownerDisplayName: 'Lecturer One',
    startedAt: AT, recordedDurationMs: 1000, segmentIndex: 0, segmentCount: 1, pauseCount: 0,
    takeoverBy: null, takeoverAt: null, takeoverByDisplayName: null, errorCode: null, errorMessage: null,
  },
  'recording.segment': { sessionId: id(), recordingId: id(), segmentId: id(), index: 0, state: 'finalized', endReason: 'stop', durationMs: 1000 },
  'recording.artifact': { recordingId: id(), sessionId: id(), state: 'ready', mergeState: 'done', durationMs: 1000, totalBytes: 2000, deleteReason: null },
  'channel.state': { channelId: 'local', state: 'on', presetId: 'fifty-fifty', ratioA: 50, ratioB: 50, reason: null },
  'sources.status': { roleId: 'presentation', state: 'online', detail: null, since: AT, inputId: id() },
  'audio.levels': { roleId: 'mic-lecturer', rms: 0.42 },
  'audio.control': { roleId: 'mic-lecturer', gain: 80, muted: false, appliedState: 'applied', lastError: null },
  'storage.status': {
    pressure: 'ok', freeBytes: 500_000_000_000, totalBytes: 1_000_000_000_000,
    policy: { maxAgeDays: 14, warningThresholdPct: 80, criticalThresholdPct: 90, earlyDeleteOrder: 'uploaded-oldest-first', neverDeleteUnuploaded: true, refuseStartWhenCritical: true },
  },
  'device.health': {
    captureCardState: 'present',
    publisherStates: { presentation: { status: 'running', lastErrorCode: null, since: AT } },
    ntpSynced: true, clockOffsetMs: 0, diskHealth: 'good', lastBootAt: AT,
  },
  'system.alert': {
    id: id(), code: 'test.alert', severity: 'warning', category: 'System', title: 'Test alert', detail: null,
    raisedAt: AT, clearedAt: null, clearedReason: null, acknowledgedBy: null, context: null, relatedEntity: null,
  },
  'log.entry': { id: id(), at: AT, level: 'INFO', category: 'System', service: 'core-api', message: 'hello', context: null, sessionId: null, userId: null },
  'ai.countdown': { state: 'armed', remainingMs: 60_000, nextAt: AT, intervalMinutes: 20 },
  'ai.set': { setId: id(), sessionId: id(), state: 'ready', trigger: 'countdown', count: 5, error: null, attempt: 0 },
  'ai.question': { questionId: id(), setId: id(), state: 'draft', provenance: 'generated', edited: false },
  'quiz.session': { state: 'open', quizSessionId: id(), joinUrl: 'https://quiz.example/join/ABC', joinCode: 'ABC123', joinedCount: 3, syncState: 'synced' },
  'quiz.publication': { publicationId: id(), questionId: id(), state: 'open', isShowing: true, projectorState: 'showing', syncState: 'synced', closeReason: null },
  'quiz.responses': {
    publicationId: id(),
    deltas: [{ studentIdNumber: 'S1001', displayName: 'Student One', selectedOptionId: id(), isCorrect: true, responseTimeMs: 1500, submittedAt: AT }],
    syncedAt: AT, stale: false,
  },
  'upload.job': { jobId: id(), recordingId: id(), state: 'uploading', attempt: 1, failureClass: null, nextAttemptAt: null, progressPct: 40, lastError: null, blockedBy: null },
  'upload.part': { partId: id(), jobId: id(), streamKey: 'main', state: 'uploading', bytesSent: 1000, bytesTotal: 2000 },
  'export.job': { jobId: id(), state: 'copying', bytesCopied: 1000, bytesTotal: 2000, error: null },
  'usb.volumes': { volumes: [] },
  'firmware.state': {
    id: id(), currentVersion: '1.0.0', availableVersion: '1.1.0', state: 'idle', signatureVerified: false,
    rollbackVersion: null, startedAt: null, finishedAt: null, lastError: null,
  },
};

interface TestApp {
  app: FastifyInstance;
  dir: string;
  pm: FakePipelineManager;
  token: string;
  sid: string;
}

async function startTestApp(): Promise<TestApp> {
  const dir = mkdtempSync(join(tmpdir(), 'core-api-panel-events-contract-'));
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
    CORE_API_JWT_SECRET: 'panel-events-contract-secret',
    CORE_API_PROVISIONING_PATH: provisioningPath,
    CORE_API_RECORDINGS_ROOT: join(dir, 'recordings'),
    CORE_API_PM_BASE_URL: pmBaseUrl,
    CORE_API_INTERNAL_BEARER: BEARER,
  });
  const ids = new UlidGenerator();
  const app = await buildApp({ config, clock: new FakeClock(NOW), ids });
  await app.lifecycle.start();

  await app.db
    .insert(users)
    .values({ id: ids.next(NOW), username: 'lecturer1', displayName: 'Lecturer One', role: 'lecturer', source: 'local', passwordHash: await hashPassword('Password1'), mustResetPassword: false, disabled: false, createdAt: NOW.toISOString() })
    .run();

  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'lecturer1', password: 'Password1', client: 'panel' } });
  const token = (login.json() as { tokens: { accessToken: string } }).tokens.accessToken;
  const sid = app.jwt.verify<{ sid: string }>(token).sid;

  return { app, dir, pm, token, sid };
}

async function stopTestApp(testApp: TestApp): Promise<void> {
  await testApp.app.close();
  await testApp.pm.close();
  rmSync(testApp.dir, { recursive: true, force: true });
}

async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: condition not met in time');
    await delay(5);
  }
}

describe('panel events contract (events.md §2 — all 22 PANEL_EVENT_NAMES)', () => {
  let testApp: TestApp | undefined;

  afterEach(async () => {
    if (!testApp) return;
    await delay(20);
    await stopTestApp(testApp);
    testApp = undefined;
  });

  it('declares exactly 22 panel event names', () => {
    expect(PANEL_EVENT_NAMES.length).toBe(22);
    expect(Object.keys(SAMPLES).length).toBe(22);
  });

  it('serializes a contract-valid envelope for every PANEL_EVENT_NAMES member through the real hub', async () => {
    testApp = await startTestApp();
    const ws = await testApp.app.injectWS('/api/v1/ws', { headers: { 'sec-websocket-protocol': testApp.token } });
    const frames: EventEnvelope[] = [];
    ws.on('message', (data: Buffer) => frames.push(JSON.parse(data.toString()) as EventEnvelope));

    // Drain the on-subscribe snapshot before publishing the sample deltas.
    await waitFor(() => frames.length > 0);
    await delay(30);
    const baseline = frames.length;

    for (const event of PANEL_EVENT_NAMES) {
      testApp.app.scopedSubscriptions.refresh(testApp.sid, 'export.job', (SAMPLES['export.job'] as { jobId: string }).jobId);
      testApp.app.scopedSubscriptions.refresh(testApp.sid, 'usb.volumes');
      testApp.app.scopedSubscriptions.refresh(testApp.sid, 'log.entry');
      testApp.app.panelHub.publish(event, SAMPLES[event] as never);
    }

    await waitFor(() => frames.length >= baseline + PANEL_EVENT_NAMES.length);
    await delay(30);

    const delivered = frames.slice(baseline);
    expect(delivered.map((f) => f.event).sort()).toEqual([...PANEL_EVENT_NAMES].sort());
    for (const frame of delivered) {
      expect(typeof frame.seq).toBe('number');
      expect(frame.at).toBe(AT);
    }

    ws.close();
  });

  it('never crosses a scoped event to a session that never subscribed to it', async () => {
    testApp = await startTestApp();
    const ws = await testApp.app.injectWS('/api/v1/ws', { headers: { 'sec-websocket-protocol': testApp.token } });
    const frames: EventEnvelope[] = [];
    ws.on('message', (data: Buffer) => frames.push(JSON.parse(data.toString()) as EventEnvelope));
    await waitFor(() => frames.length > 0);
    await delay(30);

    // No REST call ever marked this AuthSession subscribed to export.job — the live delta must not arrive.
    testApp.app.bus.publish('export.job', SAMPLES['export.job'] as never);
    await delay(50);
    expect(frames.some((f) => f.event === 'export.job')).toBe(false);

    ws.close();
  });
});
