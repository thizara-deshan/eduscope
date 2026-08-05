import { zCommandAccepted, zSystemAlert, type CommandAccepted, type SystemAlert } from '@eduscope/shared';
import { ProblemError } from '../../errors.js';
import { RESOLVE_BY_SEC } from '../commands.js';
import { isRecordingNonTerminal } from '../machines/index.js';
import { validated, nowIsoZ } from '../seed/index.js';
import { nextUlid } from '../world.js';
import { currentUser } from './auth.js';
import type { RestContext } from './index.js';

/** §6 copy deck — the ONE string used at both the S-11 entry row and this refusal (S-12 §6). */
const POWEROFF_REFUSED_TITLE = 'This device is recording — stop the lecture first.';
/** Comfortably inside RESOLVE_BY_SEC (10 s) so a successful halt resolves before the not-halted threshold in the ordinary case. */
const POWEROFF_CLOSE_AFTER_MS = 1_500;

export function createDeviceOperations(ctx: RestContext) {
  const { world, engine, seed } = ctx;

  return {
    listAlerts: async (query?: { includeCleared?: boolean }): Promise<{ items: SystemAlert[] }> => {
      const includeCleared = query?.includeCleared ?? false;
      const items = seed.alerts
        .filter((a) => includeCleared || a.clearedAt === null)
        .map((a) => validated(zSystemAlert, a));
      return { items };
    },

    acknowledgeAlert: async (alertId: string): Promise<SystemAlert> => {
      const refusal = engine.onCommand('acknowledgeAlert');
      if (refusal) throw new ProblemError(refusal);
      const row = seed.alerts.find((a) => a.id === alertId);
      if (!row) throw new ProblemError({ status: 404, code: 'not-found', title: `Unknown alert: ${alertId}` });
      row.acknowledgedBy = currentUser(ctx).id;
      return validated(zSystemAlert, row);
    },

    /**
     * v0.3, CG-16/CG-17 (S12-D-2, S12-D-3) — replaces the earlier
     * "always accepts, always raises an info alert" placeholder the S-12
     * wireframe gate settled differently: refused synchronously (409 +
     * R-22's alert, for the SECOND panel per C-2) while a session is
     * non-terminal, otherwise accepted with no resolving event — the
     * transport closing IS the resolution (C-1), simulated here via
     * `ctx.connection`. `replace: 'stall'` lets a scenario suppress that
     * close to demonstrate S-12 §5 state 8 (`accepted, not halted`).
     */
    powerOffDevice: async (): Promise<CommandAccepted> => {
      const refusal = engine.onCommand('powerOffDevice');
      if (refusal) throw new ProblemError(refusal);

      if (isRecordingNonTerminal(world)) {
        world.apply('R-22'); // the cross-panel system.alert{poweroff.refused} carrier (CG-17)
        throw new ProblemError({ status: 409, code: 'poweroff.refused', title: POWEROFF_REFUSED_TITLE });
      }

      if (!engine.onStall('powerOffDevice')) {
        ctx.connection?.closeForShutdown(POWEROFF_CLOSE_AFTER_MS);
      }
      return validated(zCommandAccepted, {
        commandId: nextUlid(world),
        acceptedAt: nowIsoZ(world.clock),
        resolveBySec: RESOLVE_BY_SEC,
      });
    },
  };
}
