import { dirname, join } from 'node:path';
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
import { registerSourceSettingsRoutes } from './modules/settings/source-routes.js';
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

  const blockDevices = options.blockDevices ?? new BlockDeviceMonitor({
    recordingsRoot: config.recordingsRoot,
    enabled: config.nodeEnv !== 'test',
    logger: { warn: (message, meta) => app.log.warn(meta ?? {}, message) },
  });
  lifecycle.register(blockDevices);
  app.decorate('blockDevices', blockDevices);
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

  const channelExecutor = new ChannelExecutor({
    get db(): DrizzleDb {
      return app.db;
    },
    clock,
    ids,
    bus,
    pm: pmClient,
    ...(options.relay !== undefined ? { relay: options.relay } : {}),
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

  app.addHook('onClose', async () => {
    await lifecycle.stop();
  });

  return app;
}
