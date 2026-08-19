import type { ChannelId, EncoderCapabilities, EncodingProfile } from '@eduscope/shared';
import { zEncodingProfileUpdate } from '@eduscope/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { ProblemError } from '../../contracts/problem.js';
import { parseBody } from '../../contracts/validate.js';
import type { DrizzleDb } from '../../db/client.js';
import { encodingProfiles } from '../../db/schema.js';
import type { Clock } from '../../lib/clock.js';
import type { IdGenerator } from '../../lib/ids.js';
import { requireAuth } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import type { EffectiveEncodeProfile } from '../recording/pm/types.js';

const CHANNEL_IDS = ['local', 'meeting', 'streaming'] as const satisfies readonly ChannelId[];

function assertAdmin(role: 'lecturer' | 'admin'): void {
  if (role !== 'admin') throw new ProblemError(403, 'not-authorized', 'Administrator role required');
}

function assertChannelId(value: string): ChannelId {
  if (!(CHANNEL_IDS as readonly string[]).includes(value)) {
    throw new ProblemError(422, 'config.invalid', `Unknown channel: ${value}`);
  }
  return value as ChannelId;
}

/**
 * AD-3/INV-EP-1's fixed capability set. Real capability probing is A's boot-time
 * job (`capabilityVerifiedAt`); until that lands, this mirrors exactly what
 * `pipeline-manager`'s `profiles.py`/`get_profile` overrides accept (KEEP B-56).
 */
export const DEVICE_ENCODER_CAPABILITIES: EncoderCapabilities = {
  videoBitrateKbps: { min: 2000, max: 8000 },
  framerates: [24, 25, 30, 50, 60],
  gops: [30, 60],
  rateControls: ['cbr', 'vbr'],
  codecs: ['h264'],
  audioBitratesKbps: [96, 128, 160],
};

function toPayload(row: typeof encodingProfiles.$inferSelect): EncodingProfile {
  return {
    id: row.id,
    scope: row.scope,
    channelId: row.channelId as ChannelId | null,
    videoBitrateKbps: row.videoBitrateKbps,
    framerate: row.framerate,
    gop: row.gop,
    rateControl: row.rateControl,
    codec: row.codec,
    container: row.container,
    audioCodec: row.audioCodec,
    audioBitrateKbps: row.audioBitrateKbps,
    capabilityVerifiedAt: row.capabilityVerifiedAt,
  };
}

function loadDeviceDefault(db: DrizzleDb): typeof encodingProfiles.$inferSelect {
  const row = db.select().from(encodingProfiles).where(eq(encodingProfiles.scope, 'device-default')).get();
  if (!row) {
    throw new Error('encoder settings: device-default encoding profile is not seeded');
  }
  return row;
}

function loadChannelOverride(db: DrizzleDb, channelId: ChannelId): typeof encodingProfiles.$inferSelect | undefined {
  return db
    .select()
    .from(encodingProfiles)
    .where(and(eq(encodingProfiles.scope, 'channel'), eq(encodingProfiles.channelId, channelId)))
    .get();
}

/** DR-14 (v1.0.0): the channel's override if one exists, else the device-default row verbatim. */
function loadEffectiveRow(db: DrizzleDb, channelId: ChannelId | null): typeof encodingProfiles.$inferSelect {
  if (channelId === null) return loadDeviceDefault(db);
  return loadChannelOverride(db, channelId) ?? loadDeviceDefault(db);
}

interface CapabilityCheckedFields {
  videoBitrateKbps: number;
  framerate: number;
  gop: number;
  rateControl: 'cbr' | 'vbr';
  audioBitrateKbps: number;
}

/** INV-EP-1: an unsupported value is rejected, never silently clamped or stored. */
function assertWithinCapabilities(fields: CapabilityCheckedFields): void {
  const caps = DEVICE_ENCODER_CAPABILITIES;
  if (fields.videoBitrateKbps < caps.videoBitrateKbps.min || fields.videoBitrateKbps > caps.videoBitrateKbps.max) {
    throw new ProblemError(422, 'config.invalid', `videoBitrateKbps must be within ${caps.videoBitrateKbps.min}-${caps.videoBitrateKbps.max}`);
  }
  if (!caps.framerates.includes(fields.framerate)) {
    throw new ProblemError(422, 'config.invalid', `framerate ${fields.framerate} is not a capability-probed value`);
  }
  if (!caps.gops.includes(fields.gop)) {
    throw new ProblemError(422, 'config.invalid', `gop ${fields.gop} is not a capability-probed value`);
  }
  if (!caps.rateControls.includes(fields.rateControl)) {
    throw new ProblemError(422, 'config.invalid', `rateControl ${fields.rateControl} is not a capability-probed value`);
  }
  if (!caps.audioBitratesKbps.includes(fields.audioBitrateKbps)) {
    throw new ProblemError(422, 'config.invalid', `audioBitrateKbps ${fields.audioBitrateKbps} is not a capability-probed value`);
  }
}

/**
 * B-24's `EffectiveEncodeProfile` PM boundary object: the channel's override if
 * one exists, else the device-default, converted from the public Kbps fields to
 * the Bps units pipeline-manager's `get_profile(...)` overrides expect. Called
 * by the recording executor (channel `local`) and the channel executor
 * (channel `streaming`) immediately before each PM start — never cached, so a
 * mid-session settings edit is picked up by the *next* start, not retroactively.
 */
export function resolveEffectiveProfile(db: DrizzleDb, channelId: ChannelId): EffectiveEncodeProfile {
  const row = loadEffectiveRow(db, channelId);
  return {
    videoBitrateBps: row.videoBitrateKbps * 1000,
    fps: row.framerate,
    gop: row.gop,
    rateControl: row.rateControl,
    audioBitrateBps: row.audioBitrateKbps * 1000,
  };
}

export interface EncoderSettingsDeps {
  db: DrizzleDb;
  clock: Clock;
  ids: IdGenerator;
}

/** Registers this task's operationIds (openapi.yaml tag `settings`): `getEncoderSettings`, `updateEncoderSettings`. Both are `x-required-role: admin`. */
export function registerEncoderSettingsRoutes(app: FastifyInstance, authService: AuthService, deps: EncoderSettingsDeps): void {
  app.get(
    '/api/v1/settings/encoder',
    { config: { operationId: 'getEncoderSettings' }, preHandler: requireAuth(authService, 'getEncoderSettings') },
    async (request, reply) => {
      assertAdmin(request.authContext!.role);
      const query = request.query as { channelId?: string };
      const channelId = query.channelId !== undefined ? assertChannelId(query.channelId) : null;
      const row = loadEffectiveRow(deps.db, channelId);
      reply.code(200).send({ profile: toPayload(row), capabilities: DEVICE_ENCODER_CAPABILITIES });
    },
  );

  app.put(
    '/api/v1/settings/encoder',
    { config: { operationId: 'updateEncoderSettings' }, preHandler: requireAuth(authService, 'updateEncoderSettings') },
    async (request, reply) => {
      assertAdmin(request.authContext!.role);
      const patch = parseBody(zEncodingProfileUpdate, request.body);
      const targetChannelId: ChannelId | null = patch.channelId !== undefined && patch.channelId !== null ? assertChannelId(patch.channelId) : null;

      const existing = targetChannelId === null ? loadDeviceDefault(deps.db) : loadChannelOverride(deps.db, targetChannelId);
      const baseline = existing ?? loadDeviceDefault(deps.db);

      const next: CapabilityCheckedFields = {
        videoBitrateKbps: patch.videoBitrateKbps ?? baseline.videoBitrateKbps,
        framerate: patch.framerate ?? baseline.framerate,
        gop: patch.gop ?? baseline.gop,
        rateControl: patch.rateControl ?? baseline.rateControl,
        audioBitrateKbps: patch.audioBitrateKbps ?? baseline.audioBitrateKbps,
      };
      assertWithinCapabilities(next);

      if (existing) {
        deps.db
          .update(encodingProfiles)
          .set({
            videoBitrateKbps: next.videoBitrateKbps,
            framerate: next.framerate,
            gop: next.gop,
            rateControl: next.rateControl,
            audioBitrateKbps: next.audioBitrateKbps,
          })
          .where(eq(encodingProfiles.id, existing.id))
          .run();
        const updated = deps.db.select().from(encodingProfiles).where(eq(encodingProfiles.id, existing.id)).get()!;
        reply.code(200).send(toPayload(updated));
        return;
      }

      // First-ever override for this channel: clone the current effective baseline (codec/container/audioCodec
      // are fixed by the device-default row, not user-editable — DM-P4/INV-EP-1) then apply the patch.
      const newId = deps.ids.next(deps.clock.now());
      deps.db
        .insert(encodingProfiles)
        .values({
          id: newId,
          scope: 'channel',
          channelId: targetChannelId,
          videoBitrateKbps: next.videoBitrateKbps,
          framerate: next.framerate,
          gop: next.gop,
          rateControl: next.rateControl,
          codec: baseline.codec,
          container: baseline.container,
          audioCodec: baseline.audioCodec,
          audioBitrateKbps: next.audioBitrateKbps,
          capabilityVerifiedAt: null,
        })
        .run();
      const created = deps.db.select().from(encodingProfiles).where(eq(encodingProfiles.id, newId)).get()!;
      reply.code(200).send(toPayload(created));
    },
  );
}

