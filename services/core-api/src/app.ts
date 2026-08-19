import { basename, dirname, join } from 'node:path';
import { statfs } from 'node:fs/promises';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { ZodError } from 'zod';
import type { CoreConfig } from './config.js';
import { loadConfig } from './config.js';
import { ProblemError } from './contracts/problem.js';
import type { CoreDatabase, DrizzleDb } from './db/client.js';
import { openDatabase } from './db/client.js';
import { migrate } from './db/migrate.js';
import { seed } from './db/seeds.js';
import type { ArgvRunner } from './lib/argv-worker.js';
import { ArgvWorker } from './lib/argv-worker.js';
import type { Clock } from './lib/clock.js';
import { SystemClock } from './lib/clock.js';
import { DomainBus } from './lib/domain-bus.js';
import type { IdGenerator } from './lib/ids.js';
import { UlidGenerator } from './lib/ids.js';
import { SecretStore } from './lib/secret-store.js';
import { LifecycleRegistry } from './lifecycle.js';
import { registerAuthRoutes } from './modules/auth/routes.js';
import { AuthService } from './modules/auth/service.js';
import type { AccessTokenClaims } from './modules/auth/tokens.js';
import { ChannelExecutor, type RelayTargetActivator } from './modules/channels/machine.js';
import { registerChannelRuntimeRoutes } from './modules/channels/runtime-routes.js';
import { registerAudioSettingsRoutes } from './modules/settings/audio-routes.js';
import { registerChannelSettingsRoutes } from './modules/settings/channel-routes.js';
import { registerEncoderSettingsRoutes } from './modules/settings/encoder-routes.js';
import { registerNetworkSettingsRoutes } from './modules/settings/network-routes.js';
import { registerSourceSettingsRoutes } from './modules/settings/source-routes.js';
import { registerStreamTargetRoutes } from './modules/settings/stream-target-routes.js';
import { RelayConfigActivator } from './modules/relay/config.js';
import { ArtifactExecutor } from './modules/library/merge-worker.js';
import { registerMediaRoutes } from './modules/library/media-route.js';
import { registerLibraryRoutes } from './modules/library/routes.js';
import { BlockDeviceMonitor, type BlockDeviceMonitorLike } from './modules/export/udev.js';
import { ScopedSubscriptionRegistry } from './modules/export/subscriptions.js';
import { registerExportRoutes } from './modules/export/routes.js';
import { ExportExecutor, type ExportSourceStream } from './modules/export/worker.js';
import { registerUploadRoutes } from './modules/uploads/routes.js';
import { UploadScheduler, type UploadAdapter } from './modules/uploads/scheduler.js';
import { PlaceholderUploadAdapter } from './modules/uploads/adapters/placeholder.js';
import type { UploadAdapter as ResumableUploadAdapter } from './modules/uploads/adapters/types.js';
import { RecordingExecutor } from './modules/recording/executor.js';
import { PipelineManagerClient } from './modules/recording/pm/client.js';
import { PipelineManagerBridge } from './modules/recording/pm/dispatcher.js';
import { registerRecordingRoutes } from './modules/recording/routes.js';
import { SourceExecutor } from './modules/sources/status.js';
import { registerSourceRoutes } from './modules/sources/routes.js';
import { lectureSessions, storageVolumes } from './db/schema.js';
import { and, eq } from 'drizzle-orm';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { StorageProbe, type StorageStatfs } from './modules/storage/probe.js';
import { RetentionSweep } from './modules/storage/retention.js';
import { registerStorageRoutes } from './modules/storage/routes.js';
import { HelperClient, UnixHelperTransport, type HelperTransport } from './lib/helper-client.js';
import { registerStorageVolumeRoutes, type StorageBlockDeviceResolver } from './modules/storage/volume-routes.js';
import { AlertStore } from './modules/device/alerts.js';
import { HealthAggregator, type NtpReader } from './modules/device/health.js';
import { ProvisioningReader } from './modules/device/provisioning.js';
import { registerDeviceRoutes } from './modules/device/routes.js';
import { registerFirmwareRoutes } from './modules/firmware/routes.js';
import { registerUsersRoutes } from './modules/users/routes.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: CoreConfig;
    clock: Clock;
    ids: IdGenerator;
    lifecycle: LifecycleRegistry;
    db: DrizzleDb;
    bus: DomainBus;
    pmClient: PipelineManagerClient;
    artifactExecutor: ArtifactExecutor;
    blockDevices: BlockDeviceMonitorLike;
    scopedSubscriptions: ScopedSubscriptionRegistry;
    exportExecutor: ExportExecutor;
    uploadScheduler: UploadScheduler;
    storageProbe: StorageProbe;
    retentionSweep: RetentionSweep;
    helperClient: HelperClient;
    alertStore: AlertStore;
    healthAggregator: HealthAggregator;
  }
}

export interface BuildAppOptions {
  config?: CoreConfig;
  clock?: Clock;
  ids?: IdGenerator;
  /** CH-02's relay push-target boundary (INV-ST-2) — tests inject a spy; production leaves this unset until B-25 supplies the real renderer. */
  relay?: RelayTargetActivator;
  /** Machine 1b's ffprobe/ffmpeg boundary (B-13) — tests inject `FakeMediaTools`; production leaves this unset to use the real `ArgvWorker`. */
  mediaRunner?: ArgvRunner;
  /** B-16 block-device boundary; tests inject deterministic hotplug snapshots. */
  blockDevices?: BlockDeviceMonitorLike;
  /** B-16 copy-stream seam; production uses createReadStream with AbortSignal. */
  exportSourceStream?: ExportSourceStream;
  /** B-17 upload boundary. Production stays dormant until B-18 supplies the placeholder adapter. */
  uploadAdapter?: UploadAdapter | ResumableUploadAdapter;
  /** Loopback fixture/placeholder endpoint; non-loopback endpoints must be HTTPS. */
  uploadBaseUrl?: string;
  /** B-19 filesystem capacity boundary; tests inject deterministic readings. */
  storageStatfs?: StorageStatfs;
  /** B-19 graceful-stop boundary; production delegates to RecordingExecutor. */
  storageStopRecording?: () => Promise<void>;
  /** B-20 helper protocol boundary; tests inject an in-memory ledger. */
  helperTransport?: HelperTransport;
  /** B-20 current-device boundary; tests inject UUID/devnode snapshots. */
  storageBlockDevices?: StorageBlockDeviceResolver;
  /** B-21 NTP boundary; tests inject a deterministic reading. */
  ntpReader?: NtpReader;
}

function zodIssuesToDetail(error: ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');
}

/**
 * Composition root. Owns one `LifecycleRegistry`; components register here as
 * their owning task lands (B-02 onward). Does not itself start the registry
 * or bind a port — `server.ts` sequences that after this resolves.
 */
export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig(process.env);
  const clock = options.clock ?? new SystemClock();
  const ids = options.ids ?? new UlidGenerator();
  const lifecycle = new LifecycleRegistry();

  const app = Fastify({ logger: true });

  let core: CoreDatabase | undefined;
  lifecycle.register({
    name: 'db',
    async start(): Promise<void> {
      core = openDatabase(config.dbPath);
      migrate(core);
      seed(core, clock.now(), ids);
      app.decorate('db', core.db);
    },
    async stop(): Promise<void> {
      core?.close();
    },
  });

  app.decorate('config', config);
  app.decorate('clock', clock);
  app.decorate('ids', ids);
  app.decorate('lifecycle', lifecycle);

  const bus = new DomainBus();
  app.decorate('bus', bus);

  const helperClient = new HelperClient({ transport: options.helperTransport ?? new UnixHelperTransport(config.helperSocketPath), clock });
  app.decorate('helperClient', helperClient);

  const pmClient = new PipelineManagerClient({
    baseUrl: config.pipelineManagerBaseUrl,
    bearerToken: config.internalBearer,
  });
  app.decorate('pmClient', pmClient);

  const pmBridge = new PipelineManagerBridge({
    client: pmClient,
    bus,
    clock,
    logger: { warn: (message, meta) => app.log.warn(meta ?? {}, message) },
  });
  lifecycle.register(pmBridge);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ProblemError) {
      reply.code(error.status).type('application/problem+json').send(error.toBody());
      return;
    }
    if (error instanceof ZodError) {
      reply
        .code(422)
        .type('application/problem+json')
        .send({ status: 422, code: 'validation.invalid', title: 'Validation failed', detail: zodIssuesToDetail(error) });
      return;
    }
    request.log.error(error);
    reply.send(error);
  });

  app.get('/healthz', async () => ({ status: 'ok' as const, contractVersion: '1.0.0' as const }));

  await app.register(fastifyJwt, { secret: config.jwtSecret });

  const authService = new AuthService({
    get db(): DrizzleDb {
      return app.db;
    },
    clock,
    ids,
    jwt: {
      sign: (claims: AccessTokenClaims): string => app.jwt.sign(claims, { expiresIn: `${config.accessTokenTtlSec}s` }),
      verify: (token: string): AccessTokenClaims => app.jwt.verify<AccessTokenClaims>(token),
    },
    accessTokenTtlSec: config.accessTokenTtlSec,
    refreshTokenTtlSec: config.refreshTokenTtlSec,
  });
  registerAuthRoutes(app, authService);

  const recordingExecutor = new RecordingExecutor({
    get db(): DrizzleDb {
      return app.db;
    },
    clock,
    ids,
    bus,
    pm: pmClient,
    provisioningPath: config.provisioningPath,
    recordingsRoot: config.recordingsRoot,
    logger: { warn: (message, meta) => app.log.warn(meta ?? {}, message) },
  });
  lifecycle.register(recordingExecutor);
  registerRecordingRoutes(app, authService, recordingExecutor);

  const artifactExecutor = new ArtifactExecutor({
    get db(): DrizzleDb {
      return app.db;
    },
    clock,
    ids,
    bus,
    runner: options.mediaRunner ?? new ArgvWorker(),
    recordingsRoot: config.recordingsRoot,
    runtimeDir: config.runtimeDir,
    logger: { warn: (message, meta) => app.log.warn(meta ?? {}, message) },
  });
  lifecycle.register(artifactExecutor);
  app.decorate('artifactExecutor', artifactExecutor);

  registerLibraryRoutes(app, authService, {
    get db(): DrizzleDb {
      return app.db;
    },
    clock,
    ids,
    bus,
    recordingsRoot: config.recordingsRoot,
    artifactExecutor,
    logger: { warn: (message, meta) => app.log.warn(meta ?? {}, message) },
  });

  registerMediaRoutes(app, authService, {
    get db(): DrizzleDb {
      return app.db;
    },
    recordingsRoot: config.recordingsRoot,
  });

  const storageProbe = new StorageProbe({
    get db(): DrizzleDb { return app.db; },
    clock,
    bus,
    statfs: options.storageStatfs ?? (config.nodeEnv === 'test'
      ? async () => ({ totalBytes: 1024 ** 4, freeBytes: 512 * 1024 ** 3 })
      : async () => {
          const value = await statfs(config.recordingsRoot);
          return { totalBytes: Number(value.blocks) * Number(value.bsize), freeBytes: Number(value.bavail) * Number(value.bsize) };
        }),
    stopRecording: options.storageStopRecording ?? (async () => {
      const active = app.db.select({ ownerUserId: lectureSessions.ownerUserId }).from(lectureSessions).where(eq(lectureSessions.state, 'recording')).get();
      if (!active?.ownerUserId) return;
      await recordingExecutor.stopRecording({ userId: active.ownerUserId, role: 'lecturer', authSessionId: 'storage-pressure', mustResetPassword: false });
    }),
    persistHealth: config.nodeEnv !== 'test' || options.storageStatfs !== undefined,
    logger: { warn: (message, meta) => app.log.warn(meta ?? {}, message) },
  });
  lifecycle.register(storageProbe);
  app.decorate('storageProbe', storageProbe);
  const retentionSweep = new RetentionSweep({
    get db(): DrizzleDb { return app.db; },
    clock,
    ids,
    bus,
    recordingsRoot: config.recordingsRoot,
    artifactExecutor,
    probe: storageProbe,
    logger: { warn: (message, meta) => app.log.warn(meta ?? {}, message) },
  });
  lifecycle.register(retentionSweep);
  app.decorate('retentionSweep', retentionSweep);
  registerStorageRoutes(app, authService, storageProbe);

  const blockDevices = options.blockDevices ?? new BlockDeviceMonitor({
    recordingsRoot: config.recordingsRoot,
    enabled: config.nodeEnv !== 'test',
    logger: { warn: (message, meta) => app.log.warn(meta ?? {}, message) },
  });
  lifecycle.register(blockDevices);
  app.decorate('blockDevices', blockDevices);
  const storageBlockDevices = options.storageBlockDevices ?? {
    async resolveUuid(uuid: string) {
      const volumes = await blockDevices.refresh();
      const current = volumes.find((volume) => basename(volume.mountPath) === uuid);
      return current ? {
        uuid,
        devNode: current.devicePath,
        mountPath: current.mountPath,
        label: current.label,
        filesystem: 'unknown',
        capacityBytes: current.capacityBytes,
        freeBytes: current.freeBytes,
      } : null;
    },
  } satisfies StorageBlockDeviceResolver;
  registerStorageVolumeRoutes(app, authService, {
    get db(): DrizzleDb { return app.db; },
    clock,
    ids,
    helper: helperClient,
    blockDevices: storageBlockDevices,
  });
  const scopedSubscriptions = new ScopedSubscriptionRegistry(clock);
  app.decorate('scopedSubscriptions', scopedSubscriptions);
  const exportExecutor = new ExportExecutor({
    get db(): DrizzleDb { return app.db; },
    clock,
    ids,
    bus,
    monitor: blockDevices,
    subscriptions: scopedSubscriptions,
    recordingsRoot: config.recordingsRoot,
    ...(options.exportSourceStream ? { sourceStream: options.exportSourceStream } : {}),
    logger: { warn: (message, meta) => app.log.warn(meta ?? {}, message) },
  });
  lifecycle.register(exportExecutor);
  app.decorate('exportExecutor', exportExecutor);
  registerExportRoutes(app, authService, exportExecutor, scopedSubscriptions);

  const uploadAdapter = options.uploadAdapter ?? (config.nodeEnv === 'test' && options.uploadBaseUrl === undefined
    ? undefined
    : new PlaceholderUploadAdapter({ baseUrl: options.uploadBaseUrl ?? 'http://127.0.0.1:8094' }));
  const uploadScheduler = new UploadScheduler({
    get db(): DrizzleDb { return app.db; },
    clock,
    ids,
    bus,
    ...(uploadAdapter ? { adapter: uploadAdapter } : {}),
    logger: { warn: (message, meta) => app.log.warn(meta ?? {}, message) },
  });
  lifecycle.register(uploadScheduler);
  app.decorate('uploadScheduler', uploadScheduler);
  registerUploadRoutes(app, authService, uploadScheduler);

  const relayConfig = new RelayConfigActivator({
    get db(): DrizzleDb {
      return app.db;
    },
    helper: helperClient,
    clock,
    ids,
  });
  // Same dormant-unless-asked-for shape as the upload adapter above: outside
  // test env the real relay is always wired; inside test env it only wires
  // in for suites that actually opted into a helper transport (B-25's own
  // tests) — the many other suites that enable the streaming channel without
  // caring about the relay keep getting the channel executor's internal
  // no-op default.
  const relay = options.relay ?? (config.nodeEnv === 'test' && options.helperTransport === undefined ? undefined : relayConfig);
  const channelExecutor = new ChannelExecutor({
    get db(): DrizzleDb {
      return app.db;
    },
    clock,
    ids,
    bus,
    pm: pmClient,
    ...(relay !== undefined ? { relay } : {}),
    logger: { warn: (message, meta) => app.log.warn(meta ?? {}, message) },
  });
  lifecycle.register(channelExecutor);
  registerChannelRuntimeRoutes(app, authService, channelExecutor);
  registerChannelSettingsRoutes(app, authService, {
    get db(): DrizzleDb {
      return app.db;
    },
    clock,
    channelExecutor,
  });

  const sourceExecutor = new SourceExecutor({
    get db(): DrizzleDb {
      return app.db;
    },
    clock,
    bus,
  });
  lifecycle.register(sourceExecutor);
  registerSourceRoutes(app, authService, sourceExecutor);

  const secretStore = await SecretStore.create({
    dir: join(dirname(config.dbPath), 'secrets'),
    key: config.secretboxKey,
    clock,
    ids,
  });
  registerSourceSettingsRoutes(app, authService, {
    get db(): DrizzleDb {
      return app.db;
    },
    clock,
    ids,
    secrets: secretStore,
    pm: pmClient,
    sources: sourceExecutor,
    logger: { warn: (message, meta) => app.log.warn(meta ?? {}, message) },
  });

  registerStreamTargetRoutes(app, authService, {
    get db(): DrizzleDb {
      return app.db;
    },
    clock,
    ids,
    secrets: secretStore,
    relay: relayConfig,
    logger: { warn: (message, meta) => app.log.warn(meta ?? {}, message) },
  });

  registerAudioSettingsRoutes(app, authService, {
    get db(): DrizzleDb {
      return app.db;
    },
    clock,
    ids,
    bus,
    pm: pmClient,
    logger: { warn: (message, meta) => app.log.warn(meta ?? {}, message) },
  });

  registerEncoderSettingsRoutes(app, authService, {
    get db(): DrizzleDb {
      return app.db;
    },
    clock,
    ids,
  });

  const provisioningReader = new ProvisioningReader(config.provisioningPath);
  const alertStore = new AlertStore({
    get db(): DrizzleDb { return app.db; },
    clock,
    ids,
    bus,
    logger: { warn: (message, meta) => app.log.warn(meta ?? {}, message) },
  });
  lifecycle.register(alertStore);
  app.decorate('alertStore', alertStore);

  const execFileAsync = promisify(execFile);
  const healthAggregator = new HealthAggregator({
    get db(): DrizzleDb { return app.db; },
    clock,
    ids,
    bus,
    helper: helperClient,
    deviceId: 'local-device',
    ntp: options.ntpReader ?? (config.nodeEnv === 'test'
      ? async () => ({ synced: true, offsetMs: 0 })
      : async () => {
          try {
            const { stdout } = await execFileAsync('timedatectl', ['show', '--property=NTPSynchronized', '--value']);
            return { synced: stdout.trim() === 'yes', offsetMs: null };
          } catch {
            return { synced: false, offsetMs: null };
          }
        }),
    smartDevNode: () => {
      const volume = app.db.select({ devicePath: storageVolumes.devicePath }).from(storageVolumes).where(and(eq(storageVolumes.role, 'recordings'), eq(storageVolumes.state, 'mounted'))).get();
      return volume?.devicePath ?? null;
    },
    logger: { warn: (message, meta) => app.log.warn(meta ?? {}, message) },
  });
  lifecycle.register(healthAggregator);
  app.decorate('healthAggregator', healthAggregator);
  registerNetworkSettingsRoutes(app, authService, {
    get db(): DrizzleDb { return app.db; },
    clock,
    ids,
    helper: helperClient,
    alerts: alertStore,
    logger: { warn: (message, meta) => app.log.warn(meta ?? {}, message) },
  });

  registerDeviceRoutes(app, authService, {
    get db(): DrizzleDb { return app.db; },
    clock,
    ids,
    helper: helperClient,
    provisioning: provisioningReader,
    health: healthAggregator,
    alerts: alertStore,
  });

  registerFirmwareRoutes(app, authService, {
    get db(): DrizzleDb { return app.db; },
    clock,
    ids,
    bus,
    helper: helperClient,
    get raw() { return core!.raw; },
    backupDir: join(dirname(config.dbPath), 'firmware-backups'),
    logger: { warn: (message, meta) => app.log.warn(meta ?? {}, message) },
  });

  registerUsersRoutes(app, authService, {
    get db(): DrizzleDb {
      return app.db;
    },
    clock,
    ids,
  });

  app.addHook('onClose', async () => {
    await lifecycle.stop();
  });

  return app;
}
