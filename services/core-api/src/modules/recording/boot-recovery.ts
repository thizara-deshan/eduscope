import { LAYOUT_PRESETS, TIMERS, type OutputSpec } from '@eduscope/shared';
import { eq, inArray } from 'drizzle-orm';
import type { DrizzleDb } from '../../db/client.js';
import { lectureSessions, recordings } from '../../db/schema.js';
import type { Clock } from '../../lib/clock.js';
import type { IdGenerator } from '../../lib/ids.js';
import { assertStorageOk, readProvisioning } from './guards.js';
import { RecordingMachine } from './machine.js';
import type { PmStatus } from './pm/types.js';

/** state-machines.md §1: the non-terminal vocabulary a "current session" read is scoped to. */
const NON_TERMINAL_STATES = ['starting', 'recording', 'paused', 'stopping', 'finalizing'] as const;

export interface BootRecoveryDeps {
  db: DrizzleDb;
  clock: Clock;
  ids: IdGenerator;
  recordingsRoot: string;
  provisioningPath: string;
}

export type BootRecoveryAction =
  | { kind: 'none' }
  | { kind: 'adopted'; sessionId: string; consumerId: string }
  | { kind: 'auto-resume'; sessionId: string; recordingId: string }
  | { kind: 'stayed-paused'; sessionId: string }
  | { kind: 'finalized'; sessionId: string };

function outputsForPreset(layoutPresetId: string): readonly OutputSpec[] {
  const preset = LAYOUT_PRESETS.find((entry) => entry.id === layoutPresetId);
  return preset?.outputs ?? [{ streamKey: 'main', roleIds: [], includeAudio: true }];
}

/** G-DEVICE-REBOOTED's negation: a `record:*` consumer pipeline-manager already reports running/degraded means core-api restarted alone (pipeline-manager's own orphan adoption, pipeline-manager.md §"Orphan adoption"). */
function liveRecordConsumerId(pmStatus: PmStatus): string | null {
  const running = pmStatus.consumers.find((consumer) => consumer.id.startsWith('record:') && (consumer.state === 'running' || consumer.state === 'degraded'));
  return running ? running.id : null;
}

/** G-RECOVERY-WINDOW. No heartbeat ever recorded is treated conservatively as outside the window. */
function withinRecoveryWindow(now: Date, lastHeartbeatAt: string | null): boolean {
  if (!lastHeartbeatAt) return false;
  return now.getTime() - new Date(lastHeartbeatAt).getTime() <= TIMERS['T-RECOVERY-WINDOW'];
}

function isStorageOk(db: DrizzleDb): boolean {
  try {
    assertStorageOk(db);
    return true;
  } catch {
    return false;
  }
}

function isProvisioned(provisioningPath: string): boolean {
  try {
    readProvisioning(provisioningPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * BR-1..BR-9 (state-machines.md §1.4). Runs once per core-api start, after
 * pipeline-manager's first `/status` (or after `T-BOOT-RECOVERY` elapses
 * without one — the caller passes an empty `PmStatus` in that case, which
 * this function treats as "no live consumer", i.e. `G-DEVICE-REBOOTED`).
 *
 * Pure DB-level decision: writes the resulting `LectureSession`/segment rows
 * directly (never through a PM call) and reports what pipeline-manager work,
 * if any, the caller — the recording executor — must still do (adopt an
 * already-running consumer, or launch a new one for `auto-resume`). The
 * caller is responsible for entering this before the executor's routes
 * accept any command, so recovery never races a live pause/resume/stop.
 */
export function runBootRecovery(deps: BootRecoveryDeps, pmStatus: PmStatus): BootRecoveryAction[] {
  const { db, clock, ids } = deps;
  const now = clock.now();
  const machine = new RecordingMachine({ db, clock, ids });

  const sessions = db.select().from(lectureSessions).where(inArray(lectureSessions.state, NON_TERMINAL_STATES)).all();
  if (sessions.length === 0) return [{ kind: 'none' }];

  // Newest first (INV-LS-1 defensive recovery, BR-9): the most recent non-terminal session is "current"; any extras are stale duplicates that must never have existed.
  const sorted = [...sessions].sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
  const [current, ...extras] = sorted;

  const actions: BootRecoveryAction[] = [];
  for (const extra of extras) {
    finalizeCrashedSession(deps, machine, extra, now); // BR-9
    actions.push({ kind: 'finalized', sessionId: extra.id });
  }

  if (current) {
    actions.push(recoverCurrent(deps, machine, current, now, pmStatus));
  }
  return actions;
}

function recoverCurrent(
  deps: BootRecoveryDeps,
  machine: RecordingMachine,
  session: typeof lectureSessions.$inferSelect,
  now: Date,
  pmStatus: PmStatus,
): BootRecoveryAction {
  switch (session.state) {
    case 'recording': {
      const liveConsumerId = liveRecordConsumerId(pmStatus);
      if (liveConsumerId) {
        return { kind: 'adopted', sessionId: session.id, consumerId: liveConsumerId }; // BR-1 — state is already `recording`, no DB write needed
      }
      if (!isStorageOk(deps.db)) {
        finalizeCrashedSession(deps, machine, session, now); // BR-8
        return { kind: 'finalized', sessionId: session.id };
      }
      if (withinRecoveryWindow(now, session.lastHeartbeatAt) && isProvisioned(deps.provisioningPath)) {
        const recording = deps.db.select().from(recordings).where(eq(recordings.sessionId, session.id)).get()!;
        machine.closeCrashedSegmentIfOpen(session.id, outputsForPreset(recording.layoutPresetId), deps.recordingsRoot);
        machine.enterRecoveryStarting(session.id, now.toISOString());
        return { kind: 'auto-resume', sessionId: session.id, recordingId: recording.id }; // BR-2
      }
      finalizeCrashedSession(deps, machine, session, now); // BR-3
      return { kind: 'finalized', sessionId: session.id };
    }
    case 'paused': {
      if (!isStorageOk(deps.db)) {
        finalizeCrashedSession(deps, machine, session, now); // BR-8
        return { kind: 'finalized', sessionId: session.id };
      }
      if (withinRecoveryWindow(now, session.lastHeartbeatAt)) {
        machine.markRecoveredPaused(session.id, now.toISOString()); // BR-4
        return { kind: 'stayed-paused', sessionId: session.id };
      }
      finalizeCrashedSession(deps, machine, session, now); // BR-5
      return { kind: 'finalized', sessionId: session.id };
    }
    case 'starting':
    case 'stopping':
      finalizeCrashedSession(deps, machine, session, now); // BR-6
      return { kind: 'finalized', sessionId: session.id };
    case 'finalizing': {
      const result = machine.completeFinalizedSession(session.id); // BR-7 — idempotent re-entry; B-13 owns checksum-based dedup of already-merged output
      return { kind: 'finalized', sessionId: result.session.id };
    }
    default:
      return { kind: 'none' };
  }
}

/** BR-3/5/6/8/9's shared shape: close a crashed open segment if one exists, stamp the recovery outcome, then finalize through B-06's own finalizing → completed/error transition. */
function finalizeCrashedSession(deps: BootRecoveryDeps, machine: RecordingMachine, session: typeof lectureSessions.$inferSelect, now: Date): void {
  if (session.state === 'recording' || session.state === 'stopping') {
    const recording = deps.db.select().from(recordings).where(eq(recordings.sessionId, session.id)).get();
    if (recording) {
      machine.closeCrashedSegmentIfOpen(session.id, outputsForPreset(recording.layoutPresetId), deps.recordingsRoot);
    }
  }
  machine.markRecoveryFinalized(session.id, now.toISOString());
  machine.enterFinalizingNoSegment(session.id);
  machine.completeFinalizedSession(session.id);
}
