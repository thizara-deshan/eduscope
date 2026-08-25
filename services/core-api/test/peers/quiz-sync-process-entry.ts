import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { storageVolumes, users } from '../../src/db/schema.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { FakeAiServices } from '../fakes/ai-services.js';
import { FakePipelineManager } from '../fakes/pipeline-manager.js';

/**
 * D-08's real-B process entry point. Real B (`buildApp`, real fetch/WS
 * routes) cannot be imported directly into quiz-service's own TypeScript
 * program — `services/quiz-service/tsconfig.json`'s `rootDir` rejects any
 * source outside that package, and both services' `declare module 'fastify'`
 * augmentations of `FastifyInstance.db` are mutually incompatible the moment
 * both `app.ts` modules land in one compilation (`TS2717`). This script runs
 * real B as its own OS process instead: `device-sync.test.ts` spawns it via
 * `tsx`, and every interaction after that crosses only real HTTP/WS — no
 * shared TypeScript program, so neither problem can occur. Only A (pipeline
 * manager) and C (AI) stay faked, exactly as every other B integration test
 * fakes them; D-08 is the two-backend (B+D) gate, not a three- or
 * four-backend one.
 */

const NOW = new Date();
const INTERNAL_BEARER = 'd08-process-internal-bearer';
const OWNER_USERNAME = 'owner';
const OWNER_PASSWORD = 'Password1';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`quiz-sync-process-entry: missing required env var ${name}`);
  return value;
}

function fullProvisioning(deviceId: string, quizServerBaseUrl: string): Record<string, unknown> {
  return {
    deviceId,
    serialNumber: 'SN-1',
    instituteProfileId: 'institute-1',
    hallCode: 'LAC001',
    hallDisplayName: 'Lecture Hall 1',
    titlePattern: '{hall} – {date} {time}',
    timezone: 'Asia/Colombo',
    ntpServers: [],
    expectedStorageVolumeUuid: null,
    featureFlags: { recordingEnabled: true, aiQuizEnabled: true, streamingEnabled: false },
    quizServerBaseUrl,
    quizDeviceCredential: requiredEnv('D08_QUIZ_DEVICE_BEARER'),
    llmEndpoint: 'http://127.0.0.1:9/llm',
    provisionedAt: '2026-01-01T00:00:00.000+00:00',
    provisionedBy: 'deploy',
  };
}

async function main(): Promise<void> {
  const quizServerBaseUrl = requiredEnv('D08_QUIZ_SERVICE_BASE_URL');
  const deviceId = requiredEnv('D08_QUIZ_DEVICE_ID');

  const dir = mkdtempSync(join(tmpdir(), 'core-api-quiz-sync-process-'));
  const pm = new FakePipelineManager({ bearerToken: INTERNAL_BEARER });
  const pmBaseUrl = await pm.listen();
  const ai = new FakeAiServices({ bearerToken: INTERNAL_BEARER });
  const aiBaseUrls = await ai.listen();

  const provisioningPath = join(dir, 'provisioning.json');
  writeFileSync(provisioningPath, JSON.stringify(fullProvisioning(deviceId, quizServerBaseUrl)));

  const config = loadConfig({
    NODE_ENV: 'test',
    CORE_API_DB_PATH: join(dir, 'core.db'),
    CORE_API_JWT_SECRET: 'd08-process-jwt-secret',
    CORE_API_PROVISIONING_PATH: provisioningPath,
    CORE_API_RECORDINGS_ROOT: join(dir, 'recordings'),
    CORE_API_RUNTIME_DIR: join(dir, 'runtime'),
    CORE_API_PM_BASE_URL: pmBaseUrl,
    CORE_API_INTERNAL_BEARER: INTERNAL_BEARER,
  });

  const ids = new UlidGenerator();
  const app = await buildApp({ config, aiBaseUrls });
  await app.lifecycle.start();
  while (pm.openConnectionCount !== 1) await delay(10);

  const ownerId = ids.next(NOW);
  app.db
    .insert(users)
    .values({
      id: ownerId,
      username: OWNER_USERNAME,
      displayName: 'Owner Lecturer',
      role: 'lecturer',
      source: 'local',
      passwordHash: await hashPassword(OWNER_PASSWORD),
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

  const loginResponse = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: OWNER_USERNAME, password: OWNER_PASSWORD, client: 'panel' } });
  const ownerToken = (loginResponse.json() as { tokens: { accessToken: string } }).tokens.accessToken;

  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  if (address === null || typeof address === 'string') throw new Error('quiz-sync-process-entry: failed to bind');
  const baseUrl = `http://127.0.0.1:${String(address.port)}`;

  // Auto-confirms the one recording/start this test ever issues — mirrors every in-process peer's
  // `pm.publish('evt.pm.consumer.running', ...)` reaction, just driven by polling since there is no
  // shared-process test to call it directly once B is its own OS process.
  void (async () => {
    let confirmed = false;
    while (!confirmed) {
      if (pm.calls.some((call) => call.path === '/consumers/record')) {
        pm.publish('evt.pm.consumer.running', { consumerId: 'record:00000001', pgid: 1 });
        confirmed = true;
      }
      await delay(20);
    }
  })();

  process.stdout.write(`${JSON.stringify({ type: 'ready', baseUrl, ownerToken })}\n`);

  let shuttingDown: Promise<void> | null = null;
  const shutdown = (): Promise<void> => {
    shuttingDown ??= (async () => {
      await app.close();
      await pm.close();
      await ai.close();
    })();
    return shuttingDown;
  };
  process.once('SIGTERM', () => void shutdown().then(() => process.exit(0)));
  process.once('SIGINT', () => void shutdown().then(() => process.exit(0)));
}

main().catch((error: unknown) => {
  process.stdout.write(`${JSON.stringify({ type: 'error', message: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
});
