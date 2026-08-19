import type { StreamTarget } from '@eduscope/shared';
import { zStreamTargetCreate, zStreamTargetUpdate } from '@eduscope/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { ProblemError } from '../../contracts/problem.js';
import { parseBody } from '../../contracts/validate.js';
import type { DrizzleDb } from '../../db/client.js';
import { streamTargets } from '../../db/schema.js';
import type { Clock } from '../../lib/clock.js';
import type { IdGenerator } from '../../lib/ids.js';
import type { SecretStore } from '../../lib/secret-store.js';
import { requireAuth } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';

function assertAdmin(role: 'lecturer' | 'admin'): void {
  if (role !== 'admin') throw new ProblemError(403, 'not-authorized', 'Administrator role required');
}

const INGEST_URL_PATTERN = /^rtmps?:\/\//;

function assertValidIngestUrl(ingestUrl: string): void {
  if (!INGEST_URL_PATTERN.test(ingestUrl)) {
    throw new ProblemError(422, 'config.invalid', 'ingestUrl must be an rtmp:// or rtmps:// URL');
  }
}

/** YouTube/Facebook ingest is always bridged through stunnel4 (ADR-010, B-58); a Custom RTMP target only needs the bridge when the operator supplied an `rtmps://` endpoint. */
function computeRequiresTlsBridge(platform: 'youtube' | 'facebook' | 'custom-rtmp', ingestUrl: string): boolean {
  return platform === 'youtube' || platform === 'facebook' || ingestUrl.startsWith('rtmps://');
}

function toPayload(row: typeof streamTargets.$inferSelect): StreamTarget {
  return {
    id: row.id,
    platform: row.platform,
    displayName: row.displayName,
    ingestUrl: row.ingestUrl,
    hasStreamKey: true,
    requiresTlsBridge: row.requiresTlsBridge,
    enabled: row.enabled,
    lastPreflightAt: row.lastPreflightAt,
    lastPreflightResult: row.lastPreflightResult,
  };
}

export interface StreamTargetRelay {
  /** Re-renders and, only on an effective change, reloads the relay from current DB state (INV-ST-3: never interrupts an active stream/recording). */
  refresh(): Promise<void>;
}

export interface StreamTargetRoutesLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

export interface StreamTargetRoutesDeps {
  db: DrizzleDb;
  clock: Clock;
  ids: IdGenerator;
  secrets: SecretStore;
  relay: StreamTargetRelay;
  logger?: StreamTargetRoutesLogger;
}

function refreshRelay(deps: StreamTargetRoutesDeps): void {
  void deps.relay.refresh().catch((error: unknown) => {
    deps.logger?.warn('stream target relay refresh failed', { error: error instanceof Error ? error.message : String(error) });
  });
}

/** Registers this task's operationIds (openapi.yaml tag `settings`): `listStreamTargets`, `createStreamTarget`, `updateStreamTarget`, `deleteStreamTarget`. All `x-required-role: admin`. */
export function registerStreamTargetRoutes(app: FastifyInstance, authService: AuthService, deps: StreamTargetRoutesDeps): void {
  app.get(
    '/api/v1/settings/stream-targets',
    { config: { operationId: 'listStreamTargets' }, preHandler: requireAuth(authService, 'listStreamTargets') },
    async (request, reply) => {
      assertAdmin(request.authContext!.role);
      const items = deps.db.select().from(streamTargets).all().map(toPayload);
      reply.code(200).send({ items });
    },
  );

  app.post(
    '/api/v1/settings/stream-targets',
    { config: { operationId: 'createStreamTarget' }, preHandler: requireAuth(authService, 'createStreamTarget') },
    async (request, reply) => {
      assertAdmin(request.authContext!.role);
      const body = parseBody(zStreamTargetCreate, request.body);
      assertValidIngestUrl(body.ingestUrl);

      const now = deps.clock.now();
      const streamKeyRef = deps.secrets.put(body.streamKey);
      const row = {
        id: deps.ids.next(now),
        platform: body.platform,
        displayName: body.displayName,
        ingestUrl: body.ingestUrl,
        streamKeyRef,
        requiresTlsBridge: computeRequiresTlsBridge(body.platform, body.ingestUrl),
        enabled: body.enabled ?? true,
        lastPreflightAt: null,
        lastPreflightResult: null,
      };
      deps.db.insert(streamTargets).values(row).run();
      reply.code(201).send(toPayload(row));
    },
  );

  app.put(
    '/api/v1/settings/stream-targets/:targetId',
    { config: { operationId: 'updateStreamTarget' }, preHandler: requireAuth(authService, 'updateStreamTarget') },
    async (request, reply) => {
      assertAdmin(request.authContext!.role);
      const { targetId } = request.params as { targetId: string };
      const patch = parseBody(zStreamTargetUpdate, request.body);

      const row = deps.db.select().from(streamTargets).where(eq(streamTargets.id, targetId)).get();
      if (!row) throw new ProblemError(404, 'not-found', 'Unknown stream target');

      const platform = patch.platform ?? row.platform;
      const ingestUrl = patch.ingestUrl ?? row.ingestUrl;
      assertValidIngestUrl(ingestUrl);

      const streamKeyRef = patch.streamKey !== undefined ? deps.secrets.put(patch.streamKey) : row.streamKeyRef;
      if (patch.streamKey !== undefined) deps.secrets.delete(row.streamKeyRef);

      const updated = {
        platform,
        displayName: patch.displayName ?? row.displayName,
        ingestUrl,
        streamKeyRef,
        requiresTlsBridge: computeRequiresTlsBridge(platform, ingestUrl),
        enabled: patch.enabled ?? row.enabled,
      };
      deps.db.update(streamTargets).set(updated).where(eq(streamTargets.id, targetId)).run();

      refreshRelay(deps);
      reply.code(200).send(toPayload({ ...row, ...updated }));
    },
  );

  app.delete(
    '/api/v1/settings/stream-targets/:targetId',
    { config: { operationId: 'deleteStreamTarget' }, preHandler: requireAuth(authService, 'deleteStreamTarget') },
    async (request, reply) => {
      assertAdmin(request.authContext!.role);
      const { targetId } = request.params as { targetId: string };
      const row = deps.db.select().from(streamTargets).where(eq(streamTargets.id, targetId)).get();
      if (!row) throw new ProblemError(404, 'not-found', 'Unknown stream target');

      deps.db.delete(streamTargets).where(eq(streamTargets.id, targetId)).run();
      deps.secrets.delete(row.streamKeyRef);

      refreshRelay(deps);
      reply.code(204).send();
    },
  );
}
