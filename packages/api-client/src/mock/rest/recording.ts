import { TIMERS, zCommandAccepted, zRecordingStateSnapshot } from '@eduscope/shared';
import { ProblemError } from '../../errors.js';
import { COMMAND_PLANS, RESOLVE_BY_SEC } from '../commands.js';
import { isRecordingNonTerminal } from '../machines/index.js';
import { validated, nowIsoZ } from '../seed/index.js';
import { PAYLOAD_BUILDERS, nextUlid } from '../world.js';
import { currentUser, requireAdmin } from './auth.js';
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

    // LP-6 mutual exclusion reads ownerUserId/ownerDisplayName off the
    // snapshot (S-06 C-4), so the starting caller must be recorded as the
    // owner up front — set synchronously here rather than as an R-01 `set`
    // effect, which can only carry a value fixed at machine-definition time,
    // never "whoever is calling right now" (same reasoning as takeoverBy below).
    startRecording: async () => {
      // R-03: mutual exclusion is SERVER-enforced (LP-6, B-15). Without this
      // the request resolved 202 and R-01 then threw `illegal transition` from
      // inside a setTimeout — an unhandled rejection, not a refusal — and
      // S-04's `refused: recorder busy` had no producer at all.
      if (isRecordingNonTerminal(world)) {
        world.emit(
          'recording.state',
          PAYLOAD_BUILDERS['recording.state']!(world, {
            id: 'snapshot', machine: 'recording', from: [], to: null, effects: [], cite: 'R-03',
          }),
        );
        throw new ProblemError({
          status: 409,
          code: 'recorder.busy',
          title: 'This device is already recording.',
          meta: {
            ownerDisplayName: (world.data['session.ownerDisplayName'] as string | null) ?? null,
            title: (world.data['session.title'] as string | null) ?? null,
          },
        });
      }
      const me = currentUser(ctx);
      world.data['session.title'] = 'CS2013 — Data Structures, Lecture 13';
      world.data['session.ownerUserId'] = me.id;
      world.data['session.ownerDisplayName'] = me.displayName;
      return accept('startRecording');
    },
    pauseRecording: async () => accept('pauseRecording'),
    resumeRecording: async () => accept('resumeRecording'),
    stopRecording: async () => accept('stopRecording'),
    // x-required-role: admin (R-21) — client.ts documents this inline.
    takeoverRecording: async () => {
      requireAdmin(ctx);
      // R-21 is `from: ['*']` — ANY NON-TERMINAL state. Scheduling it against a
      // finished session threw inside a timer; S-06 §5 state 5 words this exact
      // case as "That lecture has already ended."
      if (!isRecordingNonTerminal(world)) {
        throw new ProblemError({
          status: 409,
          code: 'conflict',
          title: 'That lecture has already ended.',
        });
      }
      const me = currentUser(ctx);
      // v0.3, CG-14 (S06-D-4): takeoverBy/At/ByDisplayName name the ACTING
      // admin, which no static transition effect can carry — set here, before
      // R-21 fires, same as acknowledgeAlert sets acknowledgedBy from
      // currentUser(ctx). R-21 itself never touches ownerUserId (C-1).
      world.data['session.takeoverBy'] = me.id;
      world.data['session.takeoverAt'] = nowIsoZ(world.clock);
      world.data['session.takeoverByDisplayName'] = me.displayName;
      return accept('takeoverRecording');
    },
  };
}

void TIMERS;
