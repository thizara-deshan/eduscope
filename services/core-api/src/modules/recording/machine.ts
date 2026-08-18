import { eq } from 'drizzle-orm';
import type { Clock } from '../../lib/clock.js';
import type { IdGenerator } from '../../lib/ids.js';
import type { DrizzleDb } from '../../db/client.js';
import { lectureSessions, recordings, recordingSegments, retentionPolicy } from '../../db/schema.js';
import type { ChannelValidResult, DeviceProvisioningSnapshot } from './guards.js';

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
}
