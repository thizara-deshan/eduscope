import type { PanelOperationId } from '@eduscope/shared';
import type { TransitionId } from './machines/types.js';

export interface CommandStep {
  readonly transition: TransitionId;
  readonly afterMs: number;
}
export type CommandPlan = readonly CommandStep[];

/**
 * operationId -> the transitions that operation kicks off, straight from the
 * state-machine tables. Follow-on steps (R-01 -> R-05) live as `fire` effects on
 * the transitions themselves, so a plan is usually one step: the command's own
 * entry point. Reads have an empty plan.
 *
 * Beyond the 12 entries the brief supplies verbatim, three more `ai`-tag
 * commands genuinely drive a machine 2c/2d transition per
 * docs/design/state-machines.md and are added here rather than treated as
 * plain seed mutation (see task-10-report.md for the reasoning):
 * `createQuestion` -> Q-19 (lecturer-authored draft creation), `editQuestion`
 * -> Q-20 (draft, edited=true), `setProjector` -> Q-36 (projector re-broadcast).
 * `discardQuestion` already existed in machine terms as Q-21 and is added for
 * the same reason. `enableChannel`/`disableChannel` keep their given bare
 * (`channel:meeting`-canonical) ids CH-04/CH-07; `rest/channels.ts` resolves
 * the id actually registered for the target channel via `channelTransitionId`
 * before scheduling, per index.ts's module comment.
 */
export const COMMAND_PLANS: Partial<Record<PanelOperationId, CommandPlan>> = {
  startRecording: [{ transition: 'R-01', afterMs: 0 }],
  pauseRecording: [{ transition: 'R-08', afterMs: 250 }],
  resumeRecording: [{ transition: 'R-10', afterMs: 250 }],
  stopRecording: [{ transition: 'R-11', afterMs: 200 }],
  takeoverRecording: [{ transition: 'R-21', afterMs: 300 }],
  enableChannel: [{ transition: 'CH-04', afterMs: 150 }],
  disableChannel: [{ transition: 'CH-07', afterMs: 150 }],
  generateNow: [{ transition: 'Q-03', afterMs: 100 }],
  setAiInterval: [{ transition: 'Q-10', afterMs: 100 }],
  sendToProjector: [{ transition: 'Q-30', afterMs: 150 }],
  closePublication: [{ transition: 'Q-35', afterMs: 150 }],
  powerOffDevice: [{ transition: 'R-22', afterMs: 200 }],

  // Added beyond the brief's 12 (see module comment above).
  createQuestion: [{ transition: 'Q-19', afterMs: 100 }],
  editQuestion: [{ transition: 'Q-20', afterMs: 100 }],
  discardQuestion: [{ transition: 'Q-21', afterMs: 100 }],
  setProjector: [{ transition: 'Q-36', afterMs: 100 }],
};

/** openapi.yaml Conventions: T-CMD-RESOLVE is 10 s. */
export const RESOLVE_BY_SEC = 10;
