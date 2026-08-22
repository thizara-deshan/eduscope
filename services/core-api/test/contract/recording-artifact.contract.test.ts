import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { FastifyInstance } from 'fastify';
import { zEventEnvelope, zRecordingArtifactPayload, type RecordingArtifactPayload } from '@eduscope/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { lectureSessions, storageVolumes, users } from '../../src/db/schema.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { FakeClock } from '../fakes/clock.js';
import { FakeMediaTools } from '../fakes/media-tools.js';
import { FakePipelineManager } from '../fakes/pipeline-manager.js';

const NOW = new Date('2026-04-10T09:00:00.000Z');
const BEARER = 'contract-test-pm-bearer-artifact';
const FIRST_CONSUMER_ID = 'record:00000001';

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
  media: FakeMediaTools;
  accessToken: string;
}

async function startTestApp(): Promise<TestApp> {
  const dir = mkdtempSync(join(tmpdir(), 'core-api-recording-artifact-contract-'));
  const pm = new FakePipelineManager({ bearerToken: BEARER });
  const pmBaseUrl = await pm.listen();
  const media = new FakeMediaTools();

  const provisioningPath = join(dir, 'provisioning.json');
  writeFileSync(
    provisioningPath,
    JSON.stringify({ deviceId: 'device-1', hallCode: 'LAC001', hallDisplayName: 'Lecture Hall 1', titlePattern: '{hall} – {date} {time}' }),
  );

  const config = loadConfig({
    NODE_ENV: 'test',
    CORE_API_DB_PATH: join(dir, 'core.db'),
    CORE_API_JWT_SECRET: 'recording-artifact-contract-secret',
    CORE_API_PROVISIONING_PATH: provisioningPath,
    CORE_API_RECORDINGS_ROOT: join(dir, 'recordings'),
    CORE_API_RUNTIME_DIR: join(dir, 'runtime'),
    CORE_API_PM_BASE_URL: pmBaseUrl,
    CORE_API_INTERNAL_BEARER: BEARER,
  });

  const clock = new FakeClock(NOW);
  const ids = new UlidGenerator();
  const app = await buildApp({ config, clock, ids, mediaRunner: media });
  await app.lifecycle.start();
  await waitFor(() => pm.openConnectionCount === 1);

  app.db
    .insert(users)
    .values({
      id: ids.next(NOW),
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

  const loginResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'lecturer1', password: 'Password1', client: 'panel' },
  });
  const accessToken = (loginResponse.json() as { tokens: { accessToken: string } }).tokens.accessToken;

  return { app, dir, pm, media, accessToken };
}

async function stopTestApp(testApp: TestApp): Promise<void> {
  await testApp.app.close();
  await testApp.pm.close();
  rmSync(testApp.dir, { recursive: true, force: true });
}

describe('recording.artifact contract (events.md §2.3, machine 1b — B-13)', () => {
  let testApp: TestApp;

  afterEach(async () => {
    await stopTestApp(testApp);
  });

  it('a stopped single-segment recording reaches ready and publishes a contract-valid recording.artifact for every transition', async () => {
    testApp = await startTestApp();
    const events: RecordingArtifactPayload[] = [];
    testApp.app.bus.subscribe('recording.artifact', (payload) => events.push(payload));
    const readyEvents: Array<{ recordingId: string; sessionId: string }> = [];
    testApp.app.bus.subscribe('artifact.ready', (payload) => readyEvents.push(payload));

    await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/recording/start',
      headers: { authorization: `Bearer ${testApp.accessToken}` },
    });
    await waitFor(() => testApp.pm.calls.some((call) => call.path === '/consumers/record'));
    testApp.pm.publish('evt.pm.consumer.running', { consumerId: FIRST_CONSUMER_ID, pgid: 1 });
    await waitFor(() => testApp.app.db.select().from(lectureSessions).all()[0]?.state === 'recording');

    await testApp.app.inject({
      method: 'POST',
      url: '/api/v1/recording/stop',
      headers: { authorization: `Bearer ${testApp.accessToken}` },
    });
    await waitFor(() => testApp.pm.calls.some((call) => call.path === `/consumers/${FIRST_CONSUMER_ID}/stop`));
    testApp.pm.publish('evt.pm.consumer.eos', { consumerId: FIRST_CONSUMER_ID });

    await waitFor(() => events.some((e) => e.state === 'ready'));

    const recordingId = events[0]!.recordingId;
    for (const payload of events.filter((e) => e.recordingId === recordingId)) {
      expect(() => zRecordingArtifactPayload.parse(payload)).not.toThrow();
    }
    expect(events.filter((e) => e.recordingId === recordingId).map((e) => e.state)).toEqual(['finalizing', 'merging', 'ready']);

    const envelope = { event: 'recording.artifact' as const, payload: events[events.length - 1]!, at: NOW.toISOString(), seq: 0 };
    expect(() => zEventEnvelope.parse(envelope)).not.toThrow();

    expect(readyEvents).toHaveLength(1);
    expect(readyEvents[0]?.recordingId).toBe(recordingId);
  });
});
