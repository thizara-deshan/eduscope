import type { PanelEventName, PanelOperationId, Problem, SmartStatus } from '@eduscope/shared';
import type { TransitionId } from '../machines/types.js';
import type { Seed } from '../seed/index.js';

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
  | 'auth-failures'
  /** Added for Wave 2's S-12 (W2-D-3, CG-16). */
  | 'poweroff-not-halted'
  /** Added for Wave 3's S-08/S-26/S-27 (W3-D-3). */
  | 'channel-failures'
  /** Added for Wave 5's S-23 (usb-pull) and S-35 (wan-loss). */
  | 'usb-pull'
  | 'wan-loss'
  /** Added for Wave 6 S-36. */
  | 'capture-fault';

export type ForcedTrigger =
  | { readonly command: PanelOperationId }
  | { readonly transition: TransitionId };

export interface ForcedTransition {
  readonly on: ForcedTrigger;
  /** 1-based occurrence to act on. Omit to apply on every occurrence. */
  readonly nth?: number;
  /**
   * Run this transition instead, refuse the command with a `Problem`, fail
   * the request at the TRANSPORT layer with no body at all (W1-D-1), or
   * accept it and never resolve it (v0.3, CG-16 — `powerOffDevice`'s
   * "accepted, not halted" state, S12-D-2: the command has no resolving
   * event, so the ONLY way a scenario can force that branch is to suppress
   * whatever side effect would otherwise resolve it — for powerOffDevice,
   * the transport closing). Only `'unreachable'` reaches `onTransport`; only
   * `'refuse'` reaches `onCommand`; only `'stall'` reaches `onStall`.
   */
  readonly replace: TransitionId | 'refuse' | 'unreachable' | 'stall';
  /** Required when `replace === 'refuse'` and the trigger is a command. */
  readonly refusal?: Problem;
  /** Override the scheduled delay so demos are not spec-length. */
  readonly delayMs?: number;
}

/**
 * World knobs applied before the world starts. Two of these are not fixture
 * shapes but LIVE world concepts — `recordingOwnedByOtherUser` (whose session
 * is currently open) and `audioApplyFails` (whether the mixer accepts a
 * change) — and they live here because this is the one place a caller can set
 * a world's starting conditions without inventing a script whose narrative is
 * a boolean (W2-D-1, W2-D-4).
 */
export interface WorldSeed {
  readonly storagePressure: 'ok' | 'warning' | 'critical';
  readonly aiEnabled: boolean;
  readonly quizAvailable: boolean;
  readonly recordingOwnedByOtherUser: boolean;
  /** S-11 §10's "scenario flag": updateAudioControl resolves `appliedState: failed` (INV-AC-1, B-55). */
  readonly audioApplyFails: boolean;
  /** W3-D-4 — starting-world fact: the Students Camera source role has no enabled binding. */
  readonly studentsCameraBound: boolean;
  /** W3-D-4 — starting-world fact: no stream targets are seeded/enabled for the streaming channel. */
  readonly streamTargetsConfigured: boolean;
  /** Wave 5 — when false, the recordings/uploads seed is empty: S-21 & S-35 empty states. */
  readonly recordingsPresent: boolean;
  /** Wave 5 — how a live export terminates (S-23 `usb-pull` uses 'drive-removed'). */
  readonly exportOutcome: 'complete' | 'drive-removed' | 'failed';
  /** Wave 6 S-36 — when false, hallCode + expectedStorageVolumeUuid are null (not-provisioned). */
  readonly provisioned: boolean;
  /** Wave 6 S-36 — when false, ntpSynced=false, clockOffsetMs large, and a clock system.alert is raised. */
  readonly clockSynced: boolean;
  /** Wave 6 S-30/S-36 — SMART status for the device health + recordings volume. */
  readonly diskHealth: SmartStatus;
  /** Wave 6 S-28 — updateNetworkConfig readback carries lastApplyError + raises an alert; prior config stays. */
  readonly networkApplyFails: boolean;
  /** Wave 6 S-31 — which terminal the firmware check/apply lifecycle drives to. */
  readonly firmwareOutcome: 'up-to-date' | 'update-available' | 'signature-fail' | 'apply-fail' | 'rolled-back';
  /** Wave 6 S-33 — importUsers returns a rejected batch with row-level reasons, writing nothing. */
  readonly userImportRejects: boolean;
}

/** A transition the script drives on its own schedule, with no command behind it. */
export interface TimelineEntry {
  readonly transition: TransitionId;
  readonly afterMs: number;
}

export interface ScenarioScript {
  readonly name: ScenarioName;
  readonly description: string;
  forced: ForcedTransition[];
  readonly seed?: Partial<WorldSeed>;
  /**
   * Transitions this script DRIVES rather than intercepts (W2-D-2). `forced`
   * can only replace a transition something else already requested, so machine
   * 5a/5b faults — which no command triggers — are otherwise unreachable.
   * Scheduled through `world.schedule` at build time, so they inherit the
   * world's clock and are discarded with it on a scenario switch.
   */
  readonly timeline?: readonly TimelineEntry[];
  /** ws-flap only: drop and restore the socket on a cycle (events.md §1). */
  readonly wsFlap?: { readonly afterMs: number; readonly downMs: number; readonly repeat: number };
  /** Wave 5 — raw entity events this script schedules with no machine behind them (usb-pull, wan-loss, disk-full's retention removal). */
  readonly emits?: readonly ScheduledEmit[];
}

/** A raw entity event a script schedules on the world clock (no machine behind it). */
export interface ScheduledEmit {
  readonly event: PanelEventName;
  readonly afterMs: number;
  /** Built from the seed so it can reference deterministic seed ids. */
  readonly payload: (seed: Seed) => unknown;
}

export interface TraceEntry {
  readonly at: string;
  readonly requested: TransitionId;
  readonly applied: TransitionId | null;
  readonly ruleIndex: number | null;
}
