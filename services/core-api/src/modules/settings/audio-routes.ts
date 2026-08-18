import type { FastifyInstance } from 'fastify';
import { TIMERS, zAudioControlUpdate, type AudioControl } from '@eduscope/shared';
import { eq, inArray } from 'drizzle-orm';
import { requireAuth } from '../auth/guard.js';
import type { AuthContext, AuthService } from '../auth/service.js';
import { ProblemError } from '../../contracts/problem.js';
import { parseBody } from '../../contracts/validate.js';
import type { DrizzleDb } from '../../db/client.js';
import { audioControls, lectureSessions } from '../../db/schema.js';
import type { Clock } from '../../lib/clock.js';
import type { DomainBus } from '../../lib/domain-bus.js';
import type { IdGenerator } from '../../lib/ids.js';
import type { PipelineManagerClient } from '../recording/pm/client.js';

/** LP-9/LP-14 — only `mic-lecturer` is mutable in V1 (openapi.yaml updateAudioControl summary). */
const MUTABLE_ROLE_ID = 'mic-lecturer';
const NON_TERMINAL_STATES = ['starting', 'recording', 'paused', 'stopping', 'finalizing'] as const;

function defaultRow(): AudioControl {
  return { roleId: MUTABLE_ROLE_ID, gain: 0, muted: false, appliedState: 'pending', lastAppliedAt: null, lastError: null };
}

function toPayload(row: typeof audioControls.$inferSelect): AudioControl {
  return {
    roleId: row.roleId as AudioControl['roleId'],
    gain: row.gain,
    muted: row.muted,
    appliedState: row.appliedState,
    lastAppliedAt: row.lastAppliedAt,
    lastError: row.lastError,
  };
}

/** CG-15: guarded only while a session is non-terminal — no session, no owner to protect (openapi.yaml updateAudioControl description). */
function assertOwnerOrAdminWhileActive(db: DrizzleDb, actor: AuthContext): void {
  const session = db.select({ ownerUserId: lectureSessions.ownerUserId }).from(lectureSessions).where(inArray(lectureSessions.state, NON_TERMINAL_STATES)).get();
  if (!session) return;
  if (actor.role === 'admin' || actor.userId === session.ownerUserId) return;
  throw new ProblemError(403, 'not-authorized', 'Only the recording owner or an admin may change audio controls while a session is active');
}

export interface AudioSettingsLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

export interface AudioSettingsDeps {
  db: DrizzleDb;
  clock: Clock;
  ids: IdGenerator;
  bus: DomainBus;
  pm: PipelineManagerClient;
  logger?: AudioSettingsLogger;
}

/**
 * Resolves the just-accepted request against A's mixer, outside the request/
 * response cycle. Success replaces the row with A's actual readback; failure
 * restores the row to its last known-applied gain/mute (`previous`) and only
 * marks `appliedState:'failed'` — the UI never sees a failed request as if it
 * had taken effect (INV-AC-1, B-55/B-12's placebo).
 */
async function applyAudioControl(
  deps: AudioSettingsDeps,
  requestedGain: number,
  requestedMuted: boolean,
  previous: { gain: number; muted: boolean; lastAppliedAt: string | null },
): Promise<void> {
  let result: { appliedState: 'applied' | 'failed'; appliedGain: number | null; appliedMuted: number | boolean | null; lastError: string | null };
  try {
    result = await deps.pm.setAudioControl(requestedGain, requestedMuted);
  } catch (error) {
    result = { appliedState: 'failed', appliedGain: null, appliedMuted: null, lastError: error instanceof Error ? error.message : String(error) };
  }

  const nowIso = deps.clock.now().toISOString();
  if (result.appliedState === 'applied') {
    deps.db
      .update(audioControls)
      .set({
        gain: result.appliedGain ?? requestedGain,
        muted: result.appliedMuted !== null ? Boolean(result.appliedMuted) : requestedMuted,
        appliedState: 'applied',
        lastAppliedAt: nowIso,
        lastError: null,
      })
      .where(eq(audioControls.roleId, MUTABLE_ROLE_ID))
      .run();
  } else {
    deps.db
      .update(audioControls)
      .set({
        gain: previous.gain,
        muted: previous.muted,
        appliedState: 'failed',
        lastAppliedAt: previous.lastAppliedAt,
        lastError: result.lastError,
      })
      .where(eq(audioControls.roleId, MUTABLE_ROLE_ID))
      .run();
  }

  const updated = deps.db.select().from(audioControls).where(eq(audioControls.roleId, MUTABLE_ROLE_ID)).get()!;
  deps.bus.publish('audio.control', toPayload(updated));
}

/** Registers this task's operationIds (openapi.yaml tag `sources`): `listAudioControls`, `updateAudioControl`. */
export function registerAudioSettingsRoutes(app: FastifyInstance, authService: AuthService, deps: AudioSettingsDeps): void {
  app.get(
    '/api/v1/audio/controls',
    { config: { operationId: 'listAudioControls' }, preHandler: requireAuth(authService, 'listAudioControls') },
    async (_request, reply) => {
      const row = deps.db.select().from(audioControls).where(eq(audioControls.roleId, MUTABLE_ROLE_ID)).get();
      reply.code(200).send({ items: [row ? toPayload(row) : defaultRow()] });
    },
  );

  app.put(
    '/api/v1/audio/controls/:roleId',
    { config: { operationId: 'updateAudioControl' }, preHandler: requireAuth(authService, 'updateAudioControl') },
    async (request, reply) => {
      const { roleId } = request.params as { roleId: string };
      const patch = parseBody(zAudioControlUpdate, request.body);
      const actor = request.authContext!;

      if (roleId !== MUTABLE_ROLE_ID) {
        throw new ProblemError(422, 'config.invalid', `${roleId} is not mutable in V1`);
      }
      assertOwnerOrAdminWhileActive(deps.db, actor);

      const current = deps.db.select().from(audioControls).where(eq(audioControls.roleId, MUTABLE_ROLE_ID)).get();
      const previous = { gain: current?.gain ?? 0, muted: current?.muted ?? false, lastAppliedAt: current?.lastAppliedAt ?? null };
      const requestedGain = patch.gain ?? previous.gain;
      const requestedMuted = patch.muted ?? previous.muted;

      const now = deps.clock.now();
      const nowIso = now.toISOString();
      if (current) {
        deps.db
          .update(audioControls)
          .set({ gain: requestedGain, muted: requestedMuted, appliedState: 'pending', updatedBy: actor.userId })
          .where(eq(audioControls.roleId, MUTABLE_ROLE_ID))
          .run();
      } else {
        deps.db
          .insert(audioControls)
          .values({ roleId: MUTABLE_ROLE_ID, gain: requestedGain, muted: requestedMuted, appliedState: 'pending', updatedBy: actor.userId })
          .run();
      }

      reply.code(202).send({ commandId: deps.ids.next(now), acceptedAt: nowIso, resolveBySec: TIMERS['T-CMD-RESOLVE'] / 1000 });

      void applyAudioControl(deps, requestedGain, requestedMuted, previous).catch((error: unknown) => {
        deps.logger?.warn('audio control apply failed unexpectedly', { error: error instanceof Error ? error.message : String(error) });
      });
    },
  );
}
