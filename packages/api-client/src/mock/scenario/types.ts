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
  | 'quiz-network-loss'
  /** Added with contract v0.2 for Wave 1's auth screens (CG-11, CG-12). */
  | 'auth-failures';

export type ForcedTrigger =
  | { readonly command: PanelOperationId }
  | { readonly transition: TransitionId };

export interface ForcedTransition {
  readonly on: ForcedTrigger;
  /** 1-based occurrence to act on. Omit to apply on every occurrence. */
  readonly nth?: number;
  /**
   * Run this transition instead, refuse the command with a `Problem`, or fail
   * the request at the TRANSPORT layer with no body at all (W1-D-1). Only
   * `'unreachable'` reaches `onTransport`; only `'refuse'` reaches `onCommand`.
   */
  readonly replace: TransitionId | 'refuse' | 'unreachable';
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
