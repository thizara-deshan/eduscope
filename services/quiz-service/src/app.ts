import type { IncomingMessage, ServerResponse } from 'node:http';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyWebsocket from '@fastify/websocket';
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
import { ProblemError } from './contracts/problem.js';
import { registerDeviceSessionRoutes } from './device/session-routes.js';
import type { JoinCodeGenerator } from './device/session-routes.js';
import { RandomJoinCodeGenerator } from './device/session-routes.js';
import { registerDevicePublicationRoutes } from './device/publication-routes.js';
import type { DomainNotifier } from './device/publication-routes.js';
import { EventEmitterDomainNotifier } from './device/publication-routes.js';
import { registerStudentJoinRoutes } from './student/join.js';
import { registerStudentRegistrationRoutes } from './student/registration.js';
import { registerStudentAnswerRoutes } from './student/answers.js';
import { registerStudentStreamRoutes, StudentStreamHub } from './student/stream.js';
import { QuizAppProblemError } from './student/identity.js';
import { registerDeviceStreamRoutes, DeviceStreamHub } from './device/stream.js';

const MAX_BODY_BYTES = 32 * 1024;

declare module 'fastify' {
  interface FastifyInstance {
    config: QuizConfig;
    clock: Clock;
    ids: IdGenerator;
    db: QuizDb;
    sql: Sql;
    sessionSerial: SessionSerial;
    joinCodeGenerator: JoinCodeGenerator;
    domainEvents: DomainNotifier;
  }

  // Every D route tags itself with `config: { operationId }` for the contract
  // tests' route->operationId assertions. `@fastify/rate-limit`'s own
  // `FastifyContextConfig` augmentation (adding `rateLimit`) turns this
  // interface from implicitly-open to closed, so `operationId` needs its own
  // declared member here or every route's route-config object literal fails
  // TypeScript's excess-property check.
  interface FastifyContextConfig {
    operationId?: string;
  }
}

/** Production passes `nextApp.getRequestHandler()`; tests inject a stand-in. */
export type PageHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

export interface BuildAppOptions {
  config?: QuizConfig;
  clock?: Clock;
  ids?: IdGenerator;
  sessionSerial?: SessionSerial;
  joinCodeGenerator?: JoinCodeGenerator;
  domainEvents?: DomainNotifier;
  pageHandler?: PageHandler;
  /** D-08 test-only seam (DR-22) — production always omits it and always allows an authenticated device-stream upgrade. */
  deviceUpgradeAllowed?: () => boolean;
  /** D-09 test-only seam for log-scan assertions on real, serialized pino output; production always logs to stdout. */
  loggerStream?: NodeJS.WritableStream;
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
  const joinCodeGenerator = options.joinCodeGenerator ?? new RandomJoinCodeGenerator();
  const domainEvents = options.domainEvents ?? new EventEmitterDomainNotifier();

  const { db, sql, close } = openDatabase(config.databaseUrl);
  await migrate(sql, DEFAULT_MIGRATIONS_DIR);

  // Only the loopback Nginx proxy may supply forwarded student/device IPs.
  const app = Fastify({
    logger: options.loggerStream ? { level: 'info', stream: options.loggerStream } : true,
    trustProxy: '127.0.0.1',
    bodyLimit: MAX_BODY_BYTES,
  });

  app.decorate('config', config);
  app.decorate('clock', clock);
  app.decorate('ids', ids);
  app.decorate('db', db);
  app.decorate('sql', sql);
  app.decorate('sessionSerial', sessionSerial);
  app.decorate('joinCodeGenerator', joinCodeGenerator);
  app.decorate('domainEvents', domainEvents);

  const STUDENT_PUBLIC_PREFIX = '/api/student/v1';

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ProblemError) {
      reply.code(error.status).type('application/problem+json').send(error.toBody());
      return;
    }
    if (error instanceof QuizAppProblemError) {
      reply.code(error.status).type('application/problem+json').send(error.toBody());
      return;
    }
    // A body over the 32 KiB cap must never leak Fastify's default error
    // shape on the public student surface; it collapses onto the same
    // contracted Problem the abuse policy uses everywhere else.
    const fastifyCode = (error as { code?: string }).code;
    if (fastifyCode === 'FST_ERR_CTP_BODY_TOO_LARGE' && request.url.startsWith(STUDENT_PUBLIC_PREFIX)) {
      // Any bytes past the cap are unread; ask the connection to close
      // instead of leaving them to be misparsed as a pipelined request.
      reply.header('connection', 'close');
      const problem = new QuizAppProblemError(503, 'quiz.unavailable', 'Quiz service unavailable');
      reply.code(problem.status).type('application/problem+json').send(problem.toBody());
      return;
    }
    request.log.error(error);
    reply.send(error);
  });

  await app.register(fastifyCookie, { secret: config.cookieSecret });
  await app.register(fastifyCors, {
    origin: (origin, callback) => callback(null, origin === config.publicOrigin),
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
  });
  await app.register(fastifyRateLimit, { global: false });
  await app.register(fastifyWebsocket);

  // Device server-to-server routes are outside this check — only browser
  // student traffic is Origin-scoped. Non-browser contract clients send no
  // `Origin` header at all and are allowed through unconditionally; a
  // present, non-matching value (including the literal string `"null"`)
  // refuses only state-changing (POST) requests. A mismatched Origin on a
  // read-only GET is left to `@fastify/cors`, which simply omits the
  // allow-origin header rather than refusing the request.
  app.addHook('onRequest', async (request) => {
    if (request.method !== 'POST' || !request.url.startsWith(STUDENT_PUBLIC_PREFIX)) return;
    const origin = request.headers.origin;
    if (origin !== undefined && origin !== config.publicOrigin) {
      throw new QuizAppProblemError(503, 'quiz.unavailable', 'Quiz service unavailable');
    }
  });

  app.get('/healthz', async () => ({ status: 'ok' as const, contractVersion: '1.0.0' as const }));

  const deviceStreamHub = new DeviceStreamHub({ db, clock, sessionSerial, logger: app.log });
  const studentStreamHub = new StudentStreamHub({ db, clock, sessionSerial, logger: app.log, deviceStreamHub });
  studentStreamHub.subscribeTo(domainEvents);

  registerDeviceSessionRoutes(app);
  registerDevicePublicationRoutes(app);
  registerStudentJoinRoutes(app);
  registerStudentRegistrationRoutes(app, deviceStreamHub);
  registerStudentAnswerRoutes(app, deviceStreamHub);
  registerStudentStreamRoutes(app, studentStreamHub);
  registerDeviceStreamRoutes(app, deviceStreamHub, options.deviceUpgradeAllowed);

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
