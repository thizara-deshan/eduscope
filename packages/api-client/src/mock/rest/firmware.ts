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
function accepted(world: RestContext['world']): CommandAccepted {
  return validated(zCommandAccepted, {
    commandId: nextUlid(world),
    acceptedAt: nowIsoZ(world.clock),
    resolveBySec: RESOLVE_BY_SEC,
  });
}

export function createFirmwareOperations(ctx: RestContext) {
  const { world, engine, seed } = ctx;
  const push = () => world.emit('firmware.state', validated(zFirmwareUpdate, seed.firmware));

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
      push();
      world.clock.setTimeout(() => {
        if (ctx.worldSeed.firmwareOutcome === 'up-to-date') {
          seed.firmware.state = 'idle';
          seed.firmware.availableVersion = null;
        } else {
          seed.firmware.state = 'idle';
          seed.firmware.availableVersion = '2026.2.0';
        }
        push();
      }, 1_000);
      return accepted(world);
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
      const outcome = ctx.worldSeed.firmwareOutcome;
      const steps: Array<() => void> = [
        () => { seed.firmware.state = 'downloading'; },
        () => { seed.firmware.state = 'verifying'; },
      ];
      if (outcome === 'signature-fail') {
        steps.push(() => {
          seed.firmware.state = 'failed';
          seed.firmware.signatureVerified = false;
          seed.firmware.lastError = 'Signature verification failed';
        });
      } else if (outcome === 'apply-fail') {
        steps.push(() => { seed.firmware.state = 'applying'; });
        steps.push(() => { seed.firmware.state = 'failed'; seed.firmware.lastError = 'Apply failed'; });
      } else if (outcome === 'rolled-back') {
        steps.push(() => { seed.firmware.state = 'applying'; });
        steps.push(() => {
          seed.firmware.state = 'rolled-back';
          seed.firmware.lastError = 'Reverted to the previous version';
        });
      } else {
        steps.push(() => { seed.firmware.state = 'applying'; });
        steps.push(() => {
          seed.firmware.state = 'done';
          seed.firmware.finishedAt = nowIsoZ(world.clock);
          seed.firmware.currentVersion = seed.firmware.availableVersion ?? seed.firmware.currentVersion;
          seed.firmware.availableVersion = null;
        });
      }
      seed.firmware.startedAt = nowIsoZ(world.clock);
      steps.forEach((step, i) => world.clock.setTimeout(() => { step(); push(); }, (i + 1) * 800));
      return accepted(world);
    },
  };
}
