import { zCommandAccepted, zFirmwareUpdate, type CommandAccepted, type FirmwareUpdate } from '@eduscope/shared';
import { ProblemError } from '../../errors.js';
import { RESOLVE_BY_SEC } from '../commands.js';
import { validated, nowIsoZ } from '../seed/index.js';
import { nextUlid } from '../world.js';
import { requireAdmin } from './auth.js';
import type { RestContext } from './index.js';

/**
 * No machine module models firmware transitions (none of machines/*.ts
 * registers a `firmware` MachineId) — checkFirmware/applyFirmware mutate
 * `seed.firmware` directly on a plain `world.clock.setTimeout`, the same
 * "no machine" category as settings.ts/uploads.ts.
 */
export function createFirmwareOperations(ctx: RestContext) {
  const { world, engine, seed } = ctx;

  return {
    getFirmwareState: async (): Promise<FirmwareUpdate> => {
      requireAdmin(ctx);
      return validated(zFirmwareUpdate, seed.firmware);
    },

    checkFirmware: async (): Promise<CommandAccepted> => {
      requireAdmin(ctx);
      const refusal = engine.onCommand('checkFirmware');
      if (refusal) throw new ProblemError(refusal);
      seed.firmware.state = 'checking';
      world.clock.setTimeout(() => {
        seed.firmware.state = 'idle';
        seed.firmware.availableVersion = '2026.2.0';
      }, 1_000);
      return validated(zCommandAccepted, {
        commandId: nextUlid(world),
        acceptedAt: nowIsoZ(world.clock),
        resolveBySec: RESOLVE_BY_SEC,
      });
    },

    applyFirmware: async (): Promise<CommandAccepted> => {
      requireAdmin(ctx);
      const refusal = engine.onCommand('applyFirmware');
      if (refusal) throw new ProblemError(refusal);
      if (world.state('recording') !== 'idle') {
        throw new ProblemError({
          status: 409,
          code: 'conflict',
          title: 'A lecture is in progress — firmware apply is refused while recording',
        });
      }
      seed.firmware.state = 'applying';
      seed.firmware.startedAt = nowIsoZ(world.clock);
      world.clock.setTimeout(() => {
        seed.firmware.state = 'done';
        seed.firmware.finishedAt = nowIsoZ(world.clock);
        seed.firmware.currentVersion = seed.firmware.availableVersion ?? seed.firmware.currentVersion;
        seed.firmware.availableVersion = null;
      }, 1_500);
      return validated(zCommandAccepted, {
        commandId: nextUlid(world),
        acceptedAt: nowIsoZ(world.clock),
        resolveBySec: RESOLVE_BY_SEC,
      });
    },
  };
}
