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
import type { Clock } from './lib/clock.js';
import { SystemClock } from './lib/clock.js';
import { DomainBus } from './lib/domain-bus.js';
import type { IdGenerator } from './lib/ids.js';
import { UlidGenerator } from './lib/ids.js';
import { LifecycleRegistry } from './lifecycle.js';
import { registerAuthRoutes } from './modules/auth/routes.js';
import { AuthService } from './modules/auth/service.js';
import type { AccessTokenClaims } from './modules/auth/tokens.js';
import { PipelineManagerClient } from './modules/recording/pm/client.js';
import { PipelineManagerBridge } from './modules/recording/pm/dispatcher.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: CoreConfig;
    clock: Clock;
    ids: IdGenerator;
    lifecycle: LifecycleRegistry;
    db: DrizzleDb;
    bus: DomainBus;
    pmClient: PipelineManagerClient;
  }
}

export interface BuildAppOptions {
  config?: CoreConfig;
  clock?: Clock;
  ids?: IdGenerator;
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

  app.addHook('onClose', async () => {
    await lifecycle.stop();
  });

  return app;
}
