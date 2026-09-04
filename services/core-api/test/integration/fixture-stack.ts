import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { loadConfig, type CoreConfig } from '../../src/config.js';
import { storageVolumes, users } from '../../src/db/schema.js';
import { SystemClock } from '../../src/lib/clock.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { FakeAiServices } from '../fakes/ai-services.js';
import { FakeBlockDeviceMonitor, type FakeBlockDevice } from '../fakes/block-devices.js';
import { startFakeHelperServer } from '../fakes/helper-server.js';
import { FakeMediaTools } from '../fakes/media-tools.js';
import { FakePipelineManager } from '../fakes/pipeline-manager.js';
import { FakeQuizService } from '../fakes/quiz-service.js';
import { UploadFixtureServer } from '../fakes/upload-fixture-server.js';

const INTERNAL_BEARER = 'b38-fixture-internal-bearer';
const QUIZ_BEARER = 'b38-fixture-quiz-bearer';

export interface FixtureStack {
  readonly dir: string;
  readonly dbPath: string;
  readonly recordingsRoot: string;
  readonly media: FakeMediaTools;
  readonly pm: FakePipelineManager;
  readonly ai: FakeAiServices;
  readonly quiz: FakeQuizService;
  readonly upload: UploadFixtureServer;
  readonly usb: FakeBlockDeviceMonitor;
  readonly usbTargets: readonly [FakeBlockDevice, FakeBlockDevice];
  readonly fixtureIds: { lecturerUsername: string; adminUsername: string };
  get app(): FastifyInstance;
  get baseUrl(): string;
  stopCore(reason?: 'SIGTERM' | 'SIGINT'): Promise<void>;
  restartCore(): Promise<void>;
  close(): Promise<void>;
}

export async function startFixtureStack(options: { port?: number; dir?: string } = {}): Promise<FixtureStack> {
  const dir = options.dir ?? mkdtempSync(join(tmpdir(), 'core-api-b38-stack-'));
  const ownsDir = options.dir === undefined;
  const dbPath = join(dir, 'core.db');
  const recordingsRoot = join(dir, 'recordings');
  const runtimeDir = join(dir, 'runtime');
  const helperSocket = join(dir, 'helper.sock');
  mkdirSync(recordingsRoot, { recursive: true });
  mkdirSync(runtimeDir, { recursive: true });

  const provisioningPath = join(dir, 'provisioning.json');
  writeFileSync(provisioningPath, JSON.stringify({
    deviceId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    serialNumber: 'B38-FIXTURE',
    instituteProfileId: 'gate',
    hallCode: 'GATE-01',
    hallDisplayName: 'B-38 Gate Hall',
    titlePattern: '{hall} – {date} {time}',
    timezone: 'Asia/Colombo',
    ntpServers: [],
    expectedStorageVolumeUuid: 'b38-recordings',
    featureFlags: { recordingEnabled: true, aiQuizEnabled: false, streamingEnabled: false },
    quizServerBaseUrl: null,
    llmEndpoint: null,
    provisionedAt: '2026-09-03T00:00:00.000Z',
    provisionedBy: 'b38-fixture',
  }));

  const pm = new FakePipelineManager({ bearerToken: INTERNAL_BEARER });
  const ai = new FakeAiServices({ bearerToken: INTERNAL_BEARER });
  const quiz = new FakeQuizService({ bearerToken: QUIZ_BEARER });
  const upload = new UploadFixtureServer();
  const media = new FakeMediaTools();
  const [pmBaseUrl, aiBaseUrls, quizBaseUrl, uploadBaseUrl, helper] = await Promise.all([
    pm.listen(),
    ai.listen(),
    quiz.listen(),
    upload.listen(),
    startFakeHelperServer(helperSocket),
  ]);

  const usbA: FakeBlockDevice = { devicePath: '/dev/b38-usb-a', mountPath: join(dir, 'usb-a'), label: 'B38 USB A', capacityBytes: 2_000_000, freeBytes: 1_500_000, usage: 'removable' };
  const usbB: FakeBlockDevice = { devicePath: '/dev/b38-usb-b', mountPath: join(dir, 'usb-b'), label: 'B38 USB B', capacityBytes: 4_000_000, freeBytes: 3_500_000, usage: 'removable' };
  mkdirSync(usbA.mountPath, { recursive: true });
  mkdirSync(usbB.mountPath, { recursive: true });
  const usb = new FakeBlockDeviceMonitor([usbA, usbB]);
  const clock = new SystemClock();
  const ids = new UlidGenerator();
  const config: CoreConfig = loadConfig({
    NODE_ENV: 'test',
    CORE_API_HOST: '127.0.0.1',
    CORE_API_PORT: String(options.port ?? 5000),
    CORE_API_DB_PATH: dbPath,
    CORE_API_RECORDINGS_ROOT: recordingsRoot,
    CORE_API_RUNTIME_DIR: runtimeDir,
    CORE_API_PROVISIONING_PATH: provisioningPath,
    CORE_API_HELPER_SOCKET: helperSocket,
    CORE_API_PM_BASE_URL: pmBaseUrl,
    CORE_API_INTERNAL_BEARER: INTERNAL_BEARER,
    CORE_API_JWT_SECRET: 'b38-fixture-jwt-secret-value-long-enough',
    CORE_API_SECRETBOX_KEY: 'b38-fixture-secretbox-key-value-long-enough',
  });

  let app: FastifyInstance;
  let baseUrl = '';
  let seeded = false;

  const startCore = async (): Promise<void> => {
    app = await buildApp({
      config,
      clock,
      ids,
      mediaRunner: media,
      blockDevices: usb as never,
      uploadBaseUrl,
      aiBaseUrls,
      quizServiceBaseUrl: quizBaseUrl,
      quizDeviceBearer: QUIZ_BEARER,
    });
    await app.lifecycle.start();
    baseUrl = await app.listen({ host: '127.0.0.1', port: options.port ?? 0 });
    if (seeded) return;
    const now = clock.now().toISOString();
    await app.db.insert(users).values([
      { id: ids.next(clock.now()), username: 'gate-lecturer', displayName: 'Gate Lecturer', role: 'lecturer', source: 'local', passwordHash: await hashPassword('GatePassphrase1!'), mustResetPassword: false, disabled: false, createdAt: now },
      { id: ids.next(clock.now()), username: 'gate-admin', displayName: 'Gate Admin', role: 'admin', source: 'local', passwordHash: await hashPassword('GateAdminPassphrase1!'), mustResetPassword: false, disabled: false, createdAt: now },
    ]).run();
    await app.db.insert(storageVolumes).values({ id: ids.next(clock.now()), uuid: 'b38-recordings', devicePath: '/dev/b38-recordings', mountPath: recordingsRoot, filesystem: 'ext4', capacityBytes: 1_000_000_000, freeBytes: 800_000_000, smartStatus: 'good', role: 'recordings', state: 'mounted', registeredAt: now }).run();
    seeded = true;
  };

  await startCore();

  let closed = false;
  const stack: FixtureStack = {
    dir,
    dbPath,
    recordingsRoot,
    media,
    pm,
    ai,
    quiz,
    upload,
    usb,
    usbTargets: [usbA, usbB],
    fixtureIds: { lecturerUsername: 'gate-lecturer', adminUsername: 'gate-admin' },
    get app() { return app; },
    get baseUrl() { return baseUrl; },
    async stopCore() {
      await app.close();
    },
    async restartCore() {
      await startCore();
    },
    async close() {
      if (closed) return;
      closed = true;
      await app.close().catch(() => undefined);
      await Promise.all([pm.close(), ai.close(), quiz.close(), upload.close()]);
      await new Promise<void>((resolveClose) => helper.server.close(() => resolveClose()));
      if (ownsDir) rmSync(dir, { recursive: true, force: true });
    },
  };
  return stack;
}

async function main(): Promise<void> {
  const port = Number(process.env.B38_FIXTURE_PORT ?? '5000');
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('B38_FIXTURE_PORT must be an integer from 1 through 65535');
  }
  const stack = await startFixtureStack({ port });
  process.stdout.write(`core-api ${stack.baseUrl}\n`);
  process.stdout.write('pipeline-manager loopback fixture ready\n');
  process.stdout.write(`fixture ids ${JSON.stringify(stack.fixtureIds)}\n`);
  process.stdout.write('fixture-stack ready\n');
  const shutdown = async (): Promise<void> => {
    await stack.close();
    process.exitCode = 0;
  };
  process.once('SIGTERM', () => { void shutdown(); });
  process.once('SIGINT', () => { void shutdown(); });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
