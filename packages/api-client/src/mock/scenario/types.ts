import type { PanelOperationId, Problem } from '@eduscope/shared';
import type { TransitionId } from '../machines/types.js';

/** frontend-conventions §4 — extend this catalog, never fork it. */
export type ScenarioName =
  | 'happy'
  | 'start-fails'
  | 'pipeline-crash-midway'
  | 'llm-timeout'
  | 'disk-full'
  | 'ws-flap'
  | 'quiz-network-loss';

export type ForcedTrigger =
  | { readonly command: PanelOperationId }
  | { readonly transition: TransitionId };

export interface ForcedTransition {
  readonly on: ForcedTrigger;
  /** 1-based occurrence to act on. Omit to apply on every occurrence. */
  readonly nth?: number;
  /** Run this instead, or cancel the transition / reject the command. */
  readonly replace: TransitionId | 'refuse';
  /** Required when `replace === 'refuse'` and the trigger is a command. */
  readonly refusal?: Problem;
  /** Override the scheduled delay so demos are not spec-length. */
  readonly delayMs?: number;
}

/** Overrides applied to the seed fixtures before the world starts. */
export interface WorldSeed {
  readonly storagePressure: 'ok' | 'warning' | 'critical';
  readonly aiEnabled: boolean;
  readonly quizAvailable: boolean;
  readonly recordingOwnedByOtherUser: boolean;
}

export interface ScenarioScript {
  readonly name: ScenarioName;
  readonly description: string;
  forced: ForcedTransition[];
  readonly seed?: Partial<WorldSeed>;
  /** ws-flap only: drop and restore the socket on a cycle (events.md §1). */
  readonly wsFlap?: { readonly afterMs: number; readonly downMs: number; readonly repeat: number };
}

export interface TraceEntry {
  readonly at: string;
  readonly requested: TransitionId;
  readonly applied: TransitionId | null;
  readonly ruleIndex: number | null;
}
