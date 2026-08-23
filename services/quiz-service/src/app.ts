import type { IncomingMessage, ServerResponse } from 'node:http';
import Fastify, { type FastifyInstance } from 'fastify';
import type { QuizConfig } from './config.js';
import { loadConfig } from './config.js';
import type { QuizDb } from './db/client.js';
import { openDatabase } from './db/client.js';
import { DEFAULT_MIGRATIONS_DIR, migrate } from './db/migrate.js';
import type { Clock } from './lib/clock.js';
import { SystemClock } from './lib/clock.js';
import type { IdGenerator } from './lib/ids.js';
import { UlidGenerator } from './lib/ids.js';
import type { SessionSerial } from './lib/session-serial.js';
import { InMemorySessionSerial } from './lib/session-serial.js';
import type { Sql } from 'postgres';

const MAX_BODY_BYTES = 32 * 1024;

declare module 'fastify' {
  interface FastifyInstance {
    config: QuizConfig;
    clock: Clock;
    ids: IdGenerator;
    db: QuizDb;
    sql: Sql;
    sessionSerial: SessionSerial;
  }
}

/** Production passes `nextApp.getRequestHandler()`; tests inject a stand-in. */
export type PageHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

export interface BuildAppOptions {
  config?: QuizConfig;
  clock?: Clock;
  ids?: IdGenerator;
  sessionSerial?: SessionSerial;
  pageHandler?: PageHandler;
}

/**
 * Composition root. Opens and migrates the real PostgreSQL database up
 * front — there is no separate lifecycle-start step, unlike core-api.
 */
export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig(process.env);
  const clock = options.clock ?? new SystemClock();
  const ids = options.ids ?? new UlidGenerator();
  const sessionSerial = options.sessionSerial ?? new InMemorySessionSerial();

  const { db, sql, close } = openDatabase(config.databaseUrl);
  await migrate(sql, DEFAULT_MIGRATIONS_DIR);

  // Only the loopback Nginx proxy may supply forwarded student/device IPs.
  const app = Fastify({ logger: true, trustProxy: '127.0.0.1', bodyLimit: MAX_BODY_BYTES });

  app.decorate('config', config);
  app.decorate('clock', clock);
  app.decorate('ids', ids);
  app.decorate('db', db);
  app.decorate('sql', sql);
  app.decorate('sessionSerial', sessionSerial);

  app.get('/healthz', async () => ({ status: 'ok' as const, contractVersion: '1.0.0' as const }));

  // Hijacks only the not-found path, after every API/WS route this and later
  // D tasks register, so the Next.js page handler is strictly a fallback.
  if (options.pageHandler) {
    const pageHandler = options.pageHandler;
    app.setNotFoundHandler((request, reply) => {
      reply.hijack();
      void pageHandler(request.raw, reply.raw);
    });
  }

  app.addHook('onClose', async () => {
    await close();
  });

  return app;
}
