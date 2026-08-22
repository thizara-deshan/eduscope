import type { OutputSpec } from '@eduscope/shared';
import { and, eq } from 'drizzle-orm';
import type { Clock } from '../../lib/clock.js';
import type { IdGenerator } from '../../lib/ids.js';
import type { DrizzleDb } from '../../db/client.js';
import { lectureSessions, recordings, recordingSegments, retentionPolicy } from '../../db/schema.js';
import type { ChannelValidResult, DeviceProvisioningSnapshot } from './guards.js';
import { closeSegment, sumRecordedDurationMs } from './segments.js';

export interface RecordingMachineDeps {
  db: DrizzleDb;
  clock: Clock;
  ids: IdGenerator;
}

/** A-07: `{hall}`/`{date}`/`{time}` are the only recognized placeholders — the pattern itself is data (domain-model.md §4.1 `titlePattern`), never code. */
export function renderTitle(pattern: string, hallDisplayName: string, now: Date): string {
  const iso = now.toISOString();
  return pattern.replace('{hall}', hallDisplayName).replace('{date}', iso.slice(0, 10)).replace('{time}', iso.slice(11, 16));
}

const DEFAULT_RETENTION_MAX_AGE_DAYS = 14;

export interface CreateStartingInput {
  provisioning: DeviceProvisioningSnapshot;
  channel: ChannelValidResult;
  ownerUserId: string;
}

export interface CreateStartingResult {
  sessionId: string;
  recordingId: string;
  title: string;
  startedAt: string;
}

export interface ConfirmRecordingResult {
  session: typeof lectureSessions.$inferSelect;
  recording: typeof recordings.$inferSelect;
  segment: typeof recordingSegments.$inferSelect;
}

export interface FailStartResult {
  session: typeof lectureSessions.$inferSelect;
  segmentsExist: boolean;
}

/**
 * The only code that writes `lecture_sessions.state` and opens/closes
 * `recording_segments` (SM-R-1, design/core-api.md §4.1). B-05 implements
 * R-01 (create), R-05 (confirm), and the R-06/R-07 failure split; B-06 adds
 * pause/resume/stop transitions on top of this same class.
 */
export class RecordingMachine {
  readonly #deps: RecordingMachineDeps;

  constructor(deps: RecordingMachineDeps) {
    this.#deps = deps;
  }

  /** R-01 step 2 (design/core-api.md §4.2): one transaction, no segment yet. */
  createStarting(input: CreateStartingInput): CreateStartingResult {
    const { db, clock, ids } = this.#deps;
    const now = clock.now();
    const nowIso = now.toISOString();
    const sessionId = ids.next(now);
    const recordingId = ids.next(now);
    const title = renderTitle(input.provisioning.titlePattern, input.provisioning.hallDisplayName, now);

    const policy = db.select({ maxAgeDays: retentionPolicy.maxAgeDays }).from(retentionPolicy).where(eq(retentionPolicy.id, 'retention-policy')).get();
    const maxAgeDays = policy?.maxAgeDays ?? DEFAULT_RETENTION_MAX_AGE_DAYS;
    // Provisional — domain-model.md defines this as `endedAt + 14 days`, but
    // `endedAt` is unknown until the lecture ends. RA-01..RA-07 (B-13) recompute
    // it accurately from the real `endedAt` on finalization; a recording never
    // reaches retention-sweep eligibility (`ready`) before that happens, so this
    // placeholder is never consulted for a real deletion decision.
    const retentionDeleteAfter = new Date(now.getTime() + maxAgeDays * 24 * 60 * 60 * 1000).toISOString();

    db.transaction((tx) => {
      tx.insert(lectureSessions)
        .values({
          id: sessionId,
          title,
          hallCode: input.provisioning.hallCode,
          hallDisplayName: input.provisioning.hallDisplayName,
          deviceId: input.provisioning.deviceId,
          ownerUserId: input.ownerUserId,
          startedByActor: 'user',
          state: 'starting',
          startedAt: nowIso,
          pauseCount: 0,
          channelActivations: [],
          sourceSnapshot: input.channel.sourceSnapshot,
          aiEnabledAtStart: false,
        })
        .run();
      tx.insert(recordings)
        .values({
          id: recordingId,
          sessionId,
          ownerUserId: input.ownerUserId,
          state: 'capturing',
          layoutPresetId: input.channel.layoutPreset.id,
          segmentCount: 0,
          mergeState: 'pending',
          retentionDeleteAfter,
          playbackAuthRequired: true,
        })
        .run();
    });

    return { sessionId, recordingId, title, startedAt: nowIso };
  }

  /** R-05: transaction → `recording`; opens segment `index = max(index)+1` (SEG-1/SEG-2). */
  confirmRecording(sessionId: string): ConfirmRecordingResult {
    const { db, clock, ids } = this.#deps;
    const now = clock.now();

    let result!: ConfirmRecordingResult;
    db.transaction((tx) => {
      const recording = tx.select().from(recordings).where(eq(recordings.sessionId, sessionId)).get();
      if (!recording) {
        throw new Error(`RecordingMachine.confirmRecording: no recording for session ${sessionId}`);
      }
      const priorIndexes = tx
        .select({ index: recordingSegments.index })
        .from(recordingSegments)
        .where(eq(recordingSegments.recordingId, recording.id))
        .all();
      const nextIndex = priorIndexes.length > 0 ? Math.max(...priorIndexes.map((row) => row.index)) + 1 : 0;

      const segmentId = ids.next(now);
      tx.insert(recordingSegments)
        .values({
          id: segmentId,
          recordingId: recording.id,
          index: nextIndex,
          startedAt: now.toISOString(),
          state: 'capturing',
        })
        .run();

      tx.update(lectureSessions).set({ state: 'recording' }).where(eq(lectureSessions.id, sessionId)).run();
      tx.update(recordings)
        .set({ segmentCount: priorIndexes.length + 1 })
        .where(eq(recordings.id, recording.id))
        .run();

      const session = tx.select().from(lectureSessions).where(eq(lectureSessions.id, sessionId)).get()!;
      const updatedRecording = tx.select().from(recordings).where(eq(recordings.id, recording.id)).get()!;
      const segment = tx.select().from(recordingSegments).where(eq(recordingSegments.id, segmentId)).get()!;
      result = { session, recording: updatedRecording, segment };
    });
    return result;
  }

  /** R-06 (no segments — `error`) / R-07 (segments exist — `stopping`, SM-R-4: preserve the lecture, no errorCode). */
  failStart(sessionId: string, errorCode: string, errorMessage: string): FailStartResult {
    const { db, clock } = this.#deps;
    const now = clock.now();

    let result!: FailStartResult;
    db.transaction((tx) => {
      const session = tx.select().from(lectureSessions).where(eq(lectureSessions.id, sessionId)).get();
      if (!session) {
        throw new Error(`RecordingMachine.failStart: unknown session ${sessionId}`);
      }
      const recording = tx.select().from(recordings).where(eq(recordings.sessionId, sessionId)).get();
      const segmentsExist = recording
        ? tx.select({ id: recordingSegments.id }).from(recordingSegments).where(eq(recordingSegments.recordingId, recording.id)).all().length > 0
        : false;

      if (segmentsExist) {
        // R-07: preserve the lecture, no errorCode (SM-R-4) — B-06 picks this
        // session back up through the same stopping→finalizing path R-11 uses.
        tx.update(lectureSessions).set({ state: 'stopping' }).where(eq(lectureSessions.id, sessionId)).run();
      } else {
        // R-06: terminal, nothing captured. `Recording` is left in `capturing`
        // (machine 1b's diagram has no `capturing`→`failed` edge — RA-05 is
        // reached only via `finalizing`, which this session never entered);
        // no task currently owns cleaning up that orphaned row.
        const startedAtMs = new Date(session.startedAt).getTime();
        tx.update(lectureSessions)
          .set({
            state: 'error',
            errorCode,
            errorMessage,
            endedAt: now.toISOString(),
            wallDurationMs: now.getTime() - startedAtMs,
          })
          .where(eq(lectureSessions.id, sessionId))
          .run();
      }

      const updated = tx.select().from(lectureSessions).where(eq(lectureSessions.id, sessionId)).get()!;
      result = { session: updated, segmentsExist };
    });
    return result;
  }

  /** R-10 step 1: `paused` → `starting` (startReason=resume). No new segment yet — confirmation reuses `confirmRecording` to open the next one (A-12). */
  enterResuming(sessionId: string): typeof lectureSessions.$inferSelect {
    const { db } = this.#deps;
    let result!: typeof lectureSessions.$inferSelect;
    db.transaction((tx) => {
      tx.update(lectureSessions).set({ state: 'starting' }).where(eq(lectureSessions.id, sessionId)).run();
      result = tx.select().from(lectureSessions).where(eq(lectureSessions.id, sessionId)).get()!;
    });
    return result;
  }

  /** R-11 first phase: `recording`/`paused` → `stopping`, the synchronous acceptance of `cmd.recording.stop` (mirrors R-01's `starting`). */
  enterStopping(sessionId: string): typeof lectureSessions.$inferSelect {
    const { db } = this.#deps;
    let result!: typeof lectureSessions.$inferSelect;
    db.transaction((tx) => {
      tx.update(lectureSessions).set({ state: 'stopping' }).where(eq(lectureSessions.id, sessionId)).run();
      result = tx.select().from(lectureSessions).where(eq(lectureSessions.id, sessionId)).get()!;
    });
    return result;
  }

  /** `stopping` → `finalizing` with no consumer to wait on (stop issued while already `paused`, or a resume that never confirmed — R-11/R-07's non-capturing path). */
  enterFinalizingNoSegment(sessionId: string): typeof lectureSessions.$inferSelect {
    const { db } = this.#deps;
    let result!: typeof lectureSessions.$inferSelect;
    db.transaction((tx) => {
      tx.update(lectureSessions).set({ state: 'finalizing' }).where(eq(lectureSessions.id, sessionId)).run();
      result = tx.select().from(lectureSessions).where(eq(lectureSessions.id, sessionId)).get()!;
    });
    return result;
  }

  /** R-08/R-09 (pause) and R-12/R-13 (stop, capturing): closes the open segment (SEG-1/SEG-3) and moves the session to `paused` or `finalizing`. */
  closeActiveSegment(sessionId: string, options: CloseActiveSegmentOptions): CloseActiveSegmentResult {
    const { db, clock, ids } = this.#deps;
    const now = clock.now();

    let result!: CloseActiveSegmentResult;
    db.transaction((tx) => {
      const session = tx.select().from(lectureSessions).where(eq(lectureSessions.id, sessionId)).get();
      if (!session) {
        throw new Error(`RecordingMachine.closeActiveSegment: unknown session ${sessionId}`);
      }
      const recording = tx.select().from(recordings).where(eq(recordings.sessionId, sessionId)).get();
      if (!recording) {
        throw new Error(`RecordingMachine.closeActiveSegment: no recording for session ${sessionId}`);
      }
      const openSegment = tx
        .select()
        .from(recordingSegments)
        .where(and(eq(recordingSegments.recordingId, recording.id), eq(recordingSegments.state, 'capturing')))
        .get();
      if (!openSegment) {
        throw new Error(`RecordingMachine.closeActiveSegment: no open segment for recording ${recording.id}`);
      }

      closeSegment(tx, {
        segment: openSegment,
        recordingId: recording.id,
        sessionId,
        now,
        ids,
        endReason: options.endReason,
        graceful: options.graceful,
        outputs: options.outputs,
        recordingsRoot: options.recordingsRoot,
      });

      const recordedDurationMs = sumRecordedDurationMs(tx, recording.id);
      tx.update(lectureSessions)
        .set({
          state: options.nextState,
          recordedDurationMs,
          pauseCount: options.bumpPauseCount ? session.pauseCount + 1 : session.pauseCount,
        })
        .where(eq(lectureSessions.id, sessionId))
        .run();

      const updatedSession = tx.select().from(lectureSessions).where(eq(lectureSessions.id, sessionId)).get()!;
      const updatedSegment = tx.select().from(recordingSegments).where(eq(recordingSegments.id, openSegment.id)).get()!;
      result = { session: updatedSession, recording, segment: updatedSegment };
    });
    return result;
  }

  /** R-14 (segments exist → `completed`) / R-15 (none → `error`, `capture.empty`). No task owns machine 1b yet (B-13), so `recordings.state` is left untouched on R-14 and only defensively marked `failed` on R-15's degenerate zero-segment case. */
  completeFinalizedSession(sessionId: string): CompleteFinalizedSessionResult {
    const { db, clock } = this.#deps;
    const now = clock.now();

    let result!: CompleteFinalizedSessionResult;
    db.transaction((tx) => {
      const session = tx.select().from(lectureSessions).where(eq(lectureSessions.id, sessionId)).get();
      if (!session) {
        throw new Error(`RecordingMachine.completeFinalizedSession: unknown session ${sessionId}`);
      }
      const recording = tx.select().from(recordings).where(eq(recordings.sessionId, sessionId)).get();
      const segmentsExist = recording
        ? tx.select({ id: recordingSegments.id }).from(recordingSegments).where(eq(recordingSegments.recordingId, recording.id)).all().length > 0
        : false;

      const startedAtMs = new Date(session.startedAt).getTime();
      const wallDurationMs = now.getTime() - startedAtMs;

      if (segmentsExist) {
        tx.update(lectureSessions)
          .set({ state: 'completed', endedAt: now.toISOString(), wallDurationMs })
          .where(eq(lectureSessions.id, sessionId))
          .run();
      } else {
        tx.update(lectureSessions)
          .set({
            state: 'error',
            errorCode: 'capture.empty',
            errorMessage: 'Recording ended with no captured segments',
            endedAt: now.toISOString(),
            wallDurationMs,
          })
          .where(eq(lectureSessions.id, sessionId))
          .run();
        if (recording) {
          tx.update(recordings).set({ state: 'failed' }).where(eq(recordings.id, recording.id)).run();
        }
      }

      const updated = tx.select().from(lectureSessions).where(eq(lectureSessions.id, sessionId)).get()!;
      result = { session: updated };
    });
    return result;
  }

  /** BR-2/3/5/8/9 (state-machines.md §1.4): closes the segment a crash left open (if any) with `endReason=crash`. A no-op transaction when nothing is open — safe to call unconditionally for any non-terminal session state. */
  closeCrashedSegmentIfOpen(sessionId: string, outputs: readonly OutputSpec[], recordingsRoot: string): CloseActiveSegmentResult | null {
    const { db, clock, ids } = this.#deps;
    const now = clock.now();

    let result: CloseActiveSegmentResult | null = null;
    db.transaction((tx) => {
      const session = tx.select().from(lectureSessions).where(eq(lectureSessions.id, sessionId)).get();
      if (!session) {
        throw new Error(`RecordingMachine.closeCrashedSegmentIfOpen: unknown session ${sessionId}`);
      }
      const recording = tx.select().from(recordings).where(eq(recordings.sessionId, sessionId)).get();
      if (!recording) {
        throw new Error(`RecordingMachine.closeCrashedSegmentIfOpen: no recording for session ${sessionId}`);
      }
      const openSegment = tx
        .select()
        .from(recordingSegments)
        .where(and(eq(recordingSegments.recordingId, recording.id), eq(recordingSegments.state, 'capturing')))
        .get();
      if (!openSegment) return;

      closeSegment(tx, {
        segment: openSegment,
        recordingId: recording.id,
        sessionId,
        now,
        ids,
        endReason: 'crash',
        graceful: false,
        outputs,
        recordingsRoot,
      });

      const recordedDurationMs = sumRecordedDurationMs(tx, recording.id);
      tx.update(lectureSessions).set({ recordedDurationMs }).where(eq(lectureSessions.id, sessionId)).run();

      const updatedSession = tx.select().from(lectureSessions).where(eq(lectureSessions.id, sessionId)).get()!;
      const updatedSegment = tx.select().from(recordingSegments).where(eq(recordingSegments.id, openSegment.id)).get()!;
      result = { session: updatedSession, recording, segment: updatedSegment };
    });
    return result;
  }

  /** BR-2: `recording` → `starting` (startReason=recovery). Confirmation reuses `confirmRecording` to open the next segment, same as R-10. */
  enterRecoveryStarting(sessionId: string, recoveredAt: string): typeof lectureSessions.$inferSelect {
    const { db } = this.#deps;
    let result!: typeof lectureSessions.$inferSelect;
    db.transaction((tx) => {
      tx.update(lectureSessions)
        .set({ state: 'starting', recoveredAt, recoveryOutcome: 'auto-resumed' })
        .where(eq(lectureSessions.id, sessionId))
        .run();
      result = tx.select().from(lectureSessions).where(eq(lectureSessions.id, sessionId)).get()!;
    });
    return result;
  }

  /** BR-3/5/8/9: stamps the recovery outcome before the session proceeds through `enterFinalizingNoSegment`/`completeFinalizedSession` (B-06). */
  markRecoveryFinalized(sessionId: string, recoveredAt: string): typeof lectureSessions.$inferSelect {
    const { db } = this.#deps;
    let result!: typeof lectureSessions.$inferSelect;
    db.transaction((tx) => {
      tx.update(lectureSessions).set({ recoveredAt, recoveryOutcome: 'finalized' }).where(eq(lectureSessions.id, sessionId)).run();
      result = tx.select().from(lectureSessions).where(eq(lectureSessions.id, sessionId)).get()!;
    });
    return result;
  }

  /** BR-4: `paused` stays `paused` — only `recoveredAt` is stamped so the panel banner (J-4) knows a recovery pass touched this session. */
  markRecoveredPaused(sessionId: string, recoveredAt: string): typeof lectureSessions.$inferSelect {
    const { db } = this.#deps;
    let result!: typeof lectureSessions.$inferSelect;
    db.transaction((tx) => {
      tx.update(lectureSessions).set({ recoveredAt }).where(eq(lectureSessions.id, sessionId)).run();
      result = tx.select().from(lectureSessions).where(eq(lectureSessions.id, sessionId)).get()!;
    });
    return result;
  }
}

export interface CloseActiveSegmentOptions {
  endReason: 'pause' | 'stop';
  graceful: boolean;
  outputs: readonly OutputSpec[];
  recordingsRoot: string;
  nextState: 'paused' | 'finalizing';
  bumpPauseCount: boolean;
}

export interface CloseActiveSegmentResult {
  session: typeof lectureSessions.$inferSelect;
  recording: typeof recordings.$inferSelect;
  segment: typeof recordingSegments.$inferSelect;
}

export interface CompleteFinalizedSessionResult {
  session: typeof lectureSessions.$inferSelect;
}
