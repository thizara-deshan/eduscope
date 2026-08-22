import type { RecordingSegmentPayload, RecordingStatePayload } from '@eduscope/shared';
import { eq, inArray } from 'drizzle-orm';
import type { DrizzleDb } from '../../db/client.js';
import { lectureSessions, recordingSegments, recordings, users } from '../../db/schema.js';

/** state-machines.md §1: the non-terminal vocabulary a "current session" read is scoped to. */
const NON_TERMINAL_STATES = ['starting', 'recording', 'paused', 'stopping', 'finalizing'] as const;

const IDLE_PAYLOAD: RecordingStatePayload = {
  state: 'idle',
  startReason: null,
  sessionId: null,
  title: null,
  ownerUserId: null,
  ownerDisplayName: null,
  startedAt: null,
  recordedDurationMs: null,
  segmentIndex: null,
  segmentCount: null,
  pauseCount: null,
  takeoverBy: null,
  takeoverAt: null,
  takeoverByDisplayName: null,
  errorCode: null,
  errorMessage: null,
};

function displayNameOf(db: DrizzleDb, userId: string | null): string | null {
  if (userId === null) return null;
  return db.select({ displayName: users.displayName }).from(users).where(eq(users.id, userId)).get()?.displayName ?? null;
}

/**
 * Builds the `recording.state` payload (contracts/events.md §2.1) for one
 * `LectureSession` row — used for both the WS transition event and the
 * `GET /recording/state` cold-boot mirror (C-9). `startReason` is a property
 * of the *transition*, not persisted state (state-machines.md §1), so a cold
 * read always renders it `null`; the caller that just performed a transition
 * passes the reason it knows.
 */
export function toRecordingStatePayload(
  db: DrizzleDb,
  session: typeof lectureSessions.$inferSelect,
  startReason: RecordingStatePayload['startReason'] = null,
): RecordingStatePayload {
  const segmentRows = db
    .select({ index: recordingSegments.index })
    .from(recordingSegments)
    .innerJoin(recordings, eq(recordingSegments.recordingId, recordings.id))
    .where(eq(recordings.sessionId, session.id))
    .all();
  const segmentCount = segmentRows.length;
  const segmentIndex = segmentCount > 0 ? Math.max(...segmentRows.map((row) => row.index)) : null;

  return {
    state: session.state,
    startReason,
    sessionId: session.id,
    title: session.title,
    ownerUserId: session.ownerUserId,
    ownerDisplayName: displayNameOf(db, session.ownerUserId),
    startedAt: session.startedAt,
    recordedDurationMs: session.recordedDurationMs ?? null,
    segmentIndex,
    segmentCount: segmentCount > 0 ? segmentCount : null,
    pauseCount: session.pauseCount,
    takeoverBy: session.takeoverBy,
    takeoverAt: session.takeoverAt,
    takeoverByDisplayName: displayNameOf(db, session.takeoverBy),
    errorCode: session.errorCode,
    errorMessage: session.errorMessage,
  };
}

/** `GET /recording/state` (getRecordingState) — a single-device database, so "the" non-terminal session (if any) is unambiguous without a provisioning read. */
export function getRecordingStateSnapshot(db: DrizzleDb): RecordingStatePayload {
  const session = db.select().from(lectureSessions).where(inArray(lectureSessions.state, NON_TERMINAL_STATES)).get();
  if (!session) return IDLE_PAYLOAD;
  return toRecordingStatePayload(db, session);
}

/** `recording.segment` (contracts/events.md §2.2), built right after SEG-1 opens/closes a segment. */
export function toRecordingSegmentPayload(
  session: { id: string },
  recording: { id: string },
  segment: typeof recordingSegments.$inferSelect,
): RecordingSegmentPayload {
  return {
    sessionId: session.id,
    recordingId: recording.id,
    segmentId: segment.id,
    index: segment.index,
    state: segment.state,
    endReason: segment.endReason,
    durationMs: segment.durationMs ?? null,
  };
}
