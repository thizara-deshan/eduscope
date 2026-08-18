import Fastify, { type FastifyInstance } from 'fastify';
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
import type { IdGenerator } from './lib/ids.js';
import { UlidGenerator } from './lib/ids.js';
import { LifecycleRegistry } from './lifecycle.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: CoreConfig;
    clock: Clock;
    ids: IdGenerator;
    lifecycle: LifecycleRegistry;
    db: DrizzleDb;
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

  app.addHook('onClose', async () => {
    await lifecycle.stop();
  });

  return app;
}
