import {
  zAudioControl, zCommandAccepted, zPhysicalInput, zSourceBinding, zSourceRole,
  zSourceStatus,
  type AudioControl, type AudioControlUpdate, type CommandAccepted,
  type PhysicalInput, type PhysicalInputUpdate, type SourceBinding,
  type SourceBindingUpdate, type SourceRole, type SourceRoleId, type SourceStatus,
  type Ulid,
} from '@eduscope/shared';
import { ProblemError } from '../../errors.js';
import { BOUND_SOURCE_ROLES } from '../machines/index.js';
import type { Transition } from '../machines/types.js';
import { RESOLVE_BY_SEC } from '../commands.js';
import { validated, nowIsoZ } from '../seed/index.js';
import { PAYLOAD_BUILDERS, nextUlid } from '../world.js';
import { requireAdmin } from './auth.js';
import type { RestContext } from './index.js';

export function createSourcesOperations(ctx: RestContext) {
  const { world, engine, seed } = ctx;

  return {
    listSourceRoles: async (): Promise<SourceRole[]> =>
      seed.sourceRoles.map((r) => validated(zSourceRole, r)),

    getSourcesStatus: async (): Promise<SourceStatus[]> =>
      seed.sourceRoles.map((role) => {
        if (!BOUND_SOURCE_ROLES.includes(role.id)) {
          const fallback = seed.sourceStatuses.find((s) => s.roleId === role.id)!;
          return validated(zSourceStatus, fallback);
        }
        const tr: Transition = {
          id: 'snapshot', machine: `source:${role.id}`, from: [], to: null, effects: [], cite: 'C-9',
        };
        // health.ts's own payload builder feeds `since` from `w.clock.nowIso()`
        // (the WS-tolerant +00:00 form) — normalize before validating against
        // the strict REST `zInstant` (same gotcha as CommandAccepted.acceptedAt).
        const payload = PAYLOAD_BUILDERS['sources.status']!(world, tr);
        return validated(zSourceStatus, { ...payload, since: nowIsoZ(world.clock) });
      }),

    listPhysicalInputs: async (): Promise<PhysicalInput[]> => {
      requireAdmin(ctx);
      return seed.physicalInputs.map((i) => validated(zPhysicalInput, i));
    },

    updatePhysicalInput: async (inputId: Ulid, body: PhysicalInputUpdate): Promise<PhysicalInput> => {
      requireAdmin(ctx);
      const refusal = engine.onCommand('updatePhysicalInput');
      if (refusal) throw new ProblemError(refusal);
      const row = seed.physicalInputs.find((i) => i.id === inputId);
      if (!row) throw new ProblemError({ status: 404, code: 'not-found', title: `Unknown input: ${inputId}` });
      Object.assign(row, {
        ...(body.address !== undefined ? { address: body.address } : {}),
        ...(body.credentialRef !== undefined ? { credentialRef: body.credentialRef } : {}),
        ...(body.transport !== undefined ? { transport: body.transport } : {}),
        updatedAt: nowIsoZ(world.clock),
      });
      return validated(zPhysicalInput, row);
    },

    listSourceBindings: async (): Promise<SourceBinding[]> => {
      requireAdmin(ctx);
      return seed.sourceBindings.map((b) => validated(zSourceBinding, b));
    },

    updateSourceBinding: async (roleId: SourceRoleId, body: SourceBindingUpdate): Promise<SourceBinding> => {
      requireAdmin(ctx);
      const refusal = engine.onCommand('updateSourceBinding');
      if (refusal) throw new ProblemError(refusal);
      // mic-room must stay unbound in V1 (INV-SR-2).
      if (roleId === 'mic-room') {
        throw new ProblemError({
          status: 422,
          code: 'validation.invalid',
          title: 'mic-room cannot be bound in V1',
        });
      }
      const row = seed.sourceBindings.find((b) => b.roleId === roleId);
      if (!row) throw new ProblemError({ status: 404, code: 'not-found', title: `Unknown role: ${roleId}` });
      Object.assign(row, {
        physicalInputId: body.physicalInputId,
        enabled: body.enabled,
        updatedAt: nowIsoZ(world.clock),
      });
      return validated(zSourceBinding, row);
    },

    listAudioControls: async (): Promise<AudioControl[]> =>
      seed.audioControls.map((a) => validated(zAudioControl, a)),

    updateAudioControl: async (roleId: SourceRoleId, body: AudioControlUpdate): Promise<CommandAccepted> => {
      const refusal = engine.onCommand('updateAudioControl');
      if (refusal) throw new ProblemError(refusal);
      const row = seed.audioControls.find((a) => a.roleId === roleId);
      if (!row) {
        throw new ProblemError({ status: 422, code: 'validation.invalid', title: `No audio control for ${roleId}` });
      }
      // No machine 5-adjacent module models AudioControl transitions; the
      // ALSA path is applied directly rather than through a scheduled
      // transition, same "no machine" category as firmware.ts / settings.ts.
      Object.assign(row, {
        ...(body.gain !== undefined ? { gain: body.gain } : {}),
        ...(body.muted !== undefined ? { muted: body.muted } : {}),
        appliedState: 'applied',
        lastAppliedAt: nowIsoZ(world.clock),
        lastError: null,
      });
      return validated(zCommandAccepted, {
        commandId: nextUlid(world),
        acceptedAt: nowIsoZ(world.clock),
        resolveBySec: RESOLVE_BY_SEC,
      });
    },
  };
}
