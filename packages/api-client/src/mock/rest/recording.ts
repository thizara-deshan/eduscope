import { TIMERS, zCommandAccepted, zRecordingStateSnapshot } from '@eduscope/shared';
import { ProblemError } from '../../errors.js';
import { COMMAND_PLANS, RESOLVE_BY_SEC } from '../commands.js';
import { validated, nowIsoZ } from '../seed/index.js';
import { PAYLOAD_BUILDERS, nextUlid } from '../world.js';
import { requireAdmin } from './auth.js';
import type { RestContext } from './index.js';

export function createRecordingOperations(ctx: RestContext) {
  const { world, engine } = ctx;

  /**
   * Shared by every 202 command: scenario refusal first, then the plan.
   * `acceptedAt` uses `nowIsoZ()`, not the given example's raw
   * `world.clock.nowIso()` — that returns a `+00:00`-suffixed instant, but
   * `zCommandAccepted.acceptedAt` (`zInstant`) is the strict Z-only variant
   * and rejects it. Fixed here per task-10-report.md's C1 finding (confirmed:
   * every 202 command threw at runtime with the brief's literal code).
   */
  function accept(operationId: keyof typeof COMMAND_PLANS) {
    const refusal = engine.onCommand(operationId);
    if (refusal) throw new ProblemError(refusal);
    for (const step of COMMAND_PLANS[operationId] ?? []) {
      world.schedule(step.transition, step.afterMs);
    }
    return validated(zCommandAccepted, {
      commandId: nextUlid(world),
      acceptedAt: nowIsoZ(world.clock),
      resolveBySec: RESOLVE_BY_SEC,
    });
  }

  return {
    // REST snapshot mirror (contract C-9) — the same shape the WS re-emits.
    getRecordingState: async () =>
      validated(zRecordingStateSnapshot, PAYLOAD_BUILDERS['recording.state']!(world, {
        id: 'snapshot', machine: 'recording', from: [], to: null, effects: [], cite: 'C-9',
      })),

    startRecording: async () => accept('startRecording'),
    pauseRecording: async () => accept('pauseRecording'),
    resumeRecording: async () => accept('resumeRecording'),
    stopRecording: async () => accept('stopRecording'),
    // x-required-role: admin (R-21) — client.ts documents this inline.
    takeoverRecording: async () => {
      requireAdmin(ctx);
      return accept('takeoverRecording');
    },
  };
}

void TIMERS;
