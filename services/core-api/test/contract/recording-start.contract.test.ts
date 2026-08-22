import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { FastifyInstance } from 'fastify';
import {
  zCommandAccepted,
  zEventEnvelope,
  zGetRecordingStateResponse,
  zProblem,
  zStartRecordingResponse,
  type RecordingSegmentPayload,
  type RecordingStatePayload,
} from '@eduscope/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { storageVolumes, users } from '../../src/db/schema.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { FakeClock } from '../fakes/clock.js';
import { FakePipelineManager } from '../fakes/pipeline-manager.js';

const NOW = new Date('2026-03-11T09:00:00.000Z');
const BEARER = 'contract-test-pm-bearer';

async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: condition not met in time');
    await delay(5);
  }
}

interface TestApp {
  app: FastifyInstance;
  dir: string;
  pm: FakePipelineManager;
  accessToken: string;
}

async function startTestApp(options: { mountVolume?: boolean } = {}): Promise<TestApp> {
  const dir = mkdtempSync(join(tmpdir(), 'core-api-recording-start-contract-'));
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
    CORE_API_JWT_SECRET: 'recording-start-contract-secret',
    CORE_API_PROVISIONING_PATH: provisioningPath,
    CORE_API_RECORDINGS_ROOT: join(dir, 'recordings'),
    CORE_API_PM_BASE_URL: pmBaseUrl,
    CORE_API_INTERNAL_BEARER: BEARER,
  });

  const clock = new FakeClock(NOW);
  const ids = new UlidGenerator();
  const app = await buildApp({ config, clock, ids });
  await app.lifecycle.start();
  await waitFor(() => pm.openConnectionCount === 1);

  const userId = ids.next(NOW);
  app.db
    .insert(users)
    .values({
      id: userId,
      username: 'lecturer1',
      displayName: 'Lecturer One',
      role: 'lecturer',
      source: 'local',
      passwordHash: await hashPassword('Password1'),
      mustResetPassword: false,
      disabled: false,
      createdAt: NOW.toISOString(),
    })
    .run();

  if (options.mountVolume !== false) {
    app.db
      .insert(storageVolumes)
      .values({
        id: ids.next(NOW),
        uuid: 'recordings-volume-1',
        devicePath: '/dev/sda1',
        mountPath: '/media/eduscope',
        filesystem: 'ext4',
        capacityBytes: 1_000_000_000_000,
        freeBytes: 500_000_000_000,
        smartStatus: 'good',
        role: 'recordings',
        state: 'mounted',
        registeredAt: NOW.toISOString(),
      })
      .run();
  }

  const loginResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'lecturer1', password: 'Password1', client: 'panel' },
  });
  const accessToken = (loginResponse.json() as { tokens: { accessToken: string } }).tokens.accessToken;

  return { app, dir, pm, accessToken };
}

async function stopTestApp(testApp: TestApp): Promise<void> {
  await testApp.app.close();
  await testApp.pm.close();
  rmSync(testApp.dir, { recursive: true, force: true });
}

describe('recording contract (openapi.yaml tag: recording — getRecordingState, startRecording)', () => {
  let testApp: TestApp;

  afterEach(async () => {
    await stopTestApp(testApp);
  });

  it('getRecordingState: 200 parses zGetRecordingStateResponse — idle when no session exists', async () => {
    testApp = await startTestApp();

    const response = await testApp.app.inject({
      method: 'GET',
      url: '/api/v1/recording/state',
      headers: { authorization: `Bearer ${testApp.accessToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = zGetRecordingStateResponse.parse(response.json());
    expect(body.state).toBe('idle');
    expect(body.sessionId).toBeNull();
  });

  it('getRecordingState: 401 without a bearer token', async () => {
    testApp = await startTestApp();

    const response = await testApp.app.inject({ method: 'GET', url: '/api/v1/recording/state' });

    expect(response.statusCode).toBe(401);
    expect(() => zProblem.parse(response.json())).not.toThrow();
  });

  it('startRecording: 202 parses zStartRecordingResponse (zCommandAccepted)', async () => {
    testApp = await startTestApp();

    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/recording/start',
      headers: { authorization: `Bearer ${testApp.accessToken}` },
    });

    expect(response.statusCode).toBe(202);
    const body = zStartRecordingResponse.parse(response.json());
    expect(zCommandAccepted.safeParse(body).success).toBe(true);
  });

  it('startRecording: 409 recorder.busy and 422 volume.unavailable both parse zProblem with the declared status', async () => {
    testApp = await startTestApp({ mountVolume: false });

    const noVolume = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/recording/start',
      headers: { authorization: `Bearer ${testApp.accessToken}` },
    });
    expect(noVolume.statusCode).toBe(422);
    const noVolumeProblem = zProblem.parse(noVolume.json());
    expect(noVolumeProblem.code).toBe('volume.unavailable');

    testApp.app.db
      .insert(storageVolumes)
      .values({
        id: 'vol-added-after',
        uuid: 'recordings-volume-2',
        devicePath: '/dev/sdb1',
        mountPath: '/media/eduscope',
        filesystem: 'ext4',
        capacityBytes: 1_000_000_000_000,
        freeBytes: 500_000_000_000,
        smartStatus: 'good',
        role: 'recordings',
        state: 'mounted',
        registeredAt: NOW.toISOString(),
      })
      .run();

    const started = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/recording/start',
      headers: { authorization: `Bearer ${testApp.accessToken}` },
    });
    expect(started.statusCode).toBe(202);

    const busy = await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/recording/start',
      headers: { authorization: `Bearer ${testApp.accessToken}` },
    });
    expect(busy.statusCode).toBe(409);
    const busyProblem = zProblem.parse(busy.json());
    expect(busyProblem.code).toBe('recorder.busy');
  });

  it('the recording.state and recording.segment payloads published across a full start→confirm cycle are contract-valid envelope members', async () => {
    testApp = await startTestApp();
    const envelopes: unknown[] = [];
    let seq = 0;
    testApp.app.bus.subscribe('recording.state', (payload: RecordingStatePayload) => {
      seq += 1;
      envelopes.push({ event: 'recording.state', payload, at: new Date().toISOString(), seq });
    });
    testApp.app.bus.subscribe('recording.segment', (payload: RecordingSegmentPayload) => {
      seq += 1;
      envelopes.push({ event: 'recording.segment', payload, at: new Date().toISOString(), seq });
    });

    await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/recording/start',
      headers: { authorization: `Bearer ${testApp.accessToken}` },
    });
    await waitFor(() => testApp.pm.calls.some((call) => call.path === '/consumers/record'));
    testApp.pm.publish('evt.pm.consumer.running', { consumerId: 'record:00000001', pgid: 1 });
    await waitFor(() => envelopes.some((event) => (event as { event: string }).event === 'recording.segment'));

    expect(envelopes.length).toBeGreaterThanOrEqual(3); // starting, recording, segment
    for (const envelope of envelopes) {
      expect(() => zEventEnvelope.parse(envelope)).not.toThrow();
    }
  });
});
