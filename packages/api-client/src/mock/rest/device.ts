import { zCommandAccepted, zSystemAlert, type CommandAccepted, type SystemAlert } from '@eduscope/shared';
import { ProblemError } from '../../errors.js';
import { COMMAND_PLANS, RESOLVE_BY_SEC } from '../commands.js';
import { validated, nowIsoZ } from '../seed/index.js';
import { nextUlid } from '../world.js';
import { currentUser } from './auth.js';
import type { RestContext } from './index.js';

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

    // A real power-off can't be simulated in a browser mock; per R-22 ('*' ->
    // null, severity info) this always accepts and always raises an
    // informational poweroff.refused alert on resolution — see
    // task-10-report.md for why that isn't a synchronous 409 here.
    powerOffDevice: async (): Promise<CommandAccepted> => {
      const refusal = engine.onCommand('powerOffDevice');
      if (refusal) throw new ProblemError(refusal);
      for (const step of COMMAND_PLANS.powerOffDevice ?? []) {
        world.schedule(step.transition, step.afterMs);
      }
      return validated(zCommandAccepted, {
        commandId: nextUlid(world),
        acceptedAt: nowIsoZ(world.clock),
        resolveBySec: RESOLVE_BY_SEC,
      });
    },
  };
}
