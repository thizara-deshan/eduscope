import { TIMERS, zCommandAccepted, zRecordingStateSnapshot } from '@eduscope/shared';
import { ProblemError } from '../../errors.js';
import { COMMAND_PLANS, RESOLVE_BY_SEC } from '../commands.js';
import { validated } from '../seed/index.js';
import { PAYLOAD_BUILDERS, nextUlid } from '../world.js';
import type { RestContext } from './index.js';

export function createRecordingOperations({ world, engine }: RestContext) {
  /** Shared by every 202 command: scenario refusal first, then the plan. */
  function accept(operationId: keyof typeof COMMAND_PLANS) {
    const refusal = engine.onCommand(operationId);
    if (refusal) throw new ProblemError(refusal);
    for (const step of COMMAND_PLANS[operationId] ?? []) {
      world.schedule(step.transition, step.afterMs);
    }
    return validated(zCommandAccepted, {
      commandId: nextUlid(world),
      acceptedAt: world.clock.nowIso(),
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
    takeoverRecording: async () => accept('takeoverRecording'),
  };
}

void TIMERS;
