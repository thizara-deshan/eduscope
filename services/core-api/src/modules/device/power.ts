import type { CommandAccepted } from '@eduscope/shared';
import { TIMERS } from '@eduscope/shared';
import { inArray } from 'drizzle-orm';
import { ProblemError } from '../../contracts/problem.js';
import type { DrizzleDb } from '../../db/client.js';
import { lectureSessions } from '../../db/schema.js';
import type { Clock } from '../../lib/clock.js';
import type { HelperClient } from '../../lib/helper-client.js';
import type { IdGenerator } from '../../lib/ids.js';
import type { AuthContext } from '../auth/service.js';
import type { AlertStore } from './alerts.js';

/** state-machines.md §1: the non-terminal vocabulary R-22's guard checks against (same set `one_active_session` enforces). */
const NON_TERMINAL_STATES = ['starting', 'recording', 'paused', 'stopping', 'finalizing'] as const;

export interface PowerOffDeps {
  db: DrizzleDb;
  clock: Clock;
  ids: IdGenerator;
  helper: HelperClient;
  alerts: AlertStore;
}

/**
 * R-22 (openapi.yaml `powerOffDevice`, LP-13, KEEP B-50): any authenticated
 * role may call this — the contract carries no `x-required-role`, and KEEP
 * B-50's disposition only adds the recording guard, not a role restriction.
 * Refuses with `poweroff.refused` + a `system.alert` while any
 * `LectureSession` is non-terminal; the guard is a synchronous DB read with
 * no `await` ahead of it, so a start that lands after route entry cannot
 * slip through — the helper only ever runs once the guard has already
 * passed. v0.3/CG-16: there is no resolving event for this command — a
 * successful halt's only observable outcome is the device ceasing to
 * answer — so this never invents a completion event; a helper failure
 * surfaces as the HTTP Problem response itself, not a background log.
 */
export async function powerOffDevice(deps: PowerOffDeps, _actor: AuthContext): Promise<CommandAccepted> {
  const active = deps.db.select({ id: lectureSessions.id }).from(lectureSessions).where(inArray(lectureSessions.state, NON_TERMINAL_STATES)).get();
  if (active) {
    deps.alerts.raise({
      code: 'poweroff.refused',
      severity: 'warning',
      category: 'System',
      title: 'Power-off refused while recording',
      detail: 'A recording is active',
    });
    throw new ProblemError(409, 'poweroff.refused', 'Power-off refused while a recording is active');
  }

  const now = deps.clock.now();
  await deps.helper.request('system.poweroff', {}, deps.ids.next(now));
  return { commandId: deps.ids.next(deps.clock.now()), acceptedAt: now.toISOString(), resolveBySec: TIMERS['T-CMD-RESOLVE'] / 1000 };
}
