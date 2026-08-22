import type { Recording, RecordingDetail, RecordingFile, RecordingSegment } from '@eduscope/shared';
import { and, desc, eq, lt, ne, or, sql } from 'drizzle-orm';
import { ProblemError } from '../../contracts/problem.js';
import type { DrizzleDb } from '../../db/client.js';
import { lectureSessions, recordingFiles, recordingSegments, recordings, uploadJobs, users } from '../../db/schema.js';
import { decodeCursor, encodeCursor } from '../../lib/cursor.js';
import type { AuthContext } from '../auth/service.js';

export interface ListRecordingsQuery {
  cursor?: string | undefined;
  limit: number;
  state?: Recording['state'] | undefined;
  includeDeleted?: boolean | undefined;
  q?: string | undefined;
  ownerUserId?: string | undefined;
}

export interface ListRecordingsResult {
  items: Recording[];
  nextCursor: string | null;
}

interface JoinedRow {
  recording: typeof recordings.$inferSelect;
  title: string;
  hallDisplayName: string;
  startedAt: string;
  endedAt: string | null;
  ownerDisplayName: string;
  uploadState: string | null;
}

function toRecordingPayload(row: JoinedRow): Recording {
  const r = row.recording;
  return {
    id: r.id,
    sessionId: r.sessionId,
    title: row.title,
    hallDisplayName: row.hallDisplayName,
    ownerUserId: r.ownerUserId,
    ownerDisplayName: row.ownerDisplayName,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    state: r.state,
    layoutPresetId: r.layoutPresetId as Recording['layoutPresetId'],
    durationMs: r.durationMs ?? null,
    totalBytes: r.totalBytes ?? null,
    segmentCount: r.segmentCount,
    mergeState: r.mergeState,
    uploadState: (row.uploadState as Recording['uploadState']) ?? null,
    retentionDeleteAfter: r.retentionDeleteAfter,
    deletedAt: r.deletedAt,
    deleteReason: r.deleteReason,
  };
}

function toSegmentPayload(row: typeof recordingSegments.$inferSelect): RecordingSegment {
  return {
    id: row.id,
    recordingId: row.recordingId,
    index: row.index,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    durationMs: row.durationMs ?? null,
    endReason: row.endReason,
    state: row.state,
  };
}

function toFilePayload(row: typeof recordingFiles.$inferSelect): RecordingFile {
  return {
    id: row.id,
    recordingId: row.recordingId,
    segmentId: row.segmentId,
    kind: row.kind,
    streamKey: row.streamKey,
    container: row.container,
    sizeBytes: row.sizeBytes ?? null,
    durationMs: row.durationMs ?? null,
    state: row.state,
    hasAudio: row.hasAudio,
    isUploadable: row.isUploadable,
  };
}

const baseSelection = {
  recording: recordings,
  title: lectureSessions.title,
  hallDisplayName: lectureSessions.hallDisplayName,
  startedAt: lectureSessions.startedAt,
  endedAt: lectureSessions.endedAt,
  ownerDisplayName: users.displayName,
  uploadState: uploadJobs.state,
} as const;

function joinedQuery(db: DrizzleDb) {
  return db
    .select(baseSelection)
    .from(recordings)
    .innerJoin(lectureSessions, eq(recordings.sessionId, lectureSessions.id))
    .innerJoin(users, eq(recordings.ownerUserId, users.id))
    .leftJoin(uploadJobs, eq(uploadJobs.recordingId, recordings.id));
}

/** `listRecordings` (openapi.yaml, design/core-api.md §5.3): server-side ownership (INV-RC-5), filters, and `(startedAt, id)` keyset pagination — never a client-filtered page. */
export function listRecordings(db: DrizzleDb, actor: AuthContext, query: ListRecordingsQuery): ListRecordingsResult {
  const conditions = [];

  if (actor.role === 'lecturer') {
    conditions.push(eq(recordings.ownerUserId, actor.userId));
  } else if (query.ownerUserId !== undefined) {
    conditions.push(eq(recordings.ownerUserId, query.ownerUserId));
  }

  const includeDeleted = actor.role === 'admin' && query.includeDeleted === true;
  if (!includeDeleted) {
    conditions.push(ne(recordings.state, 'deleted'));
  }

  if (query.state !== undefined) {
    conditions.push(eq(recordings.state, query.state));
  }

  if (query.q !== undefined && query.q.length > 0) {
    conditions.push(sql`lower(${lectureSessions.title}) like ${`%${query.q.toLowerCase()}%`}`);
  }

  if (query.cursor !== undefined) {
    const cursor = decodeCursor(query.cursor);
    conditions.push(
      or(
        lt(lectureSessions.startedAt, cursor.startedAt),
        and(eq(lectureSessions.startedAt, cursor.startedAt), lt(recordings.id, cursor.id)),
      ),
    );
  }

  const rows = joinedQuery(db)
    .where(and(...conditions))
    .orderBy(desc(lectureSessions.startedAt), desc(recordings.id))
    .limit(query.limit + 1)
    .all();

  const page = rows.slice(0, query.limit);
  const nextCursor =
    rows.length > query.limit
      ? encodeCursor({ startedAt: page[page.length - 1]!.startedAt, id: page[page.length - 1]!.recording.id })
      : null;

  return { items: page.map(toRecordingPayload), nextCursor };
}

/** `getRecording`: 404 for both "unknown" and "not yours" — INV-RC-6 never distinguishes the two to a non-owner. */
export function getRecording(db: DrizzleDb, recordingId: string, actor: AuthContext): RecordingDetail {
  const row = joinedQuery(db).where(eq(recordings.id, recordingId)).get();
  if (!row) {
    throw new ProblemError(404, 'not-found', 'Recording not found');
  }
  if (actor.role !== 'admin' && row.recording.ownerUserId !== actor.userId) {
    throw new ProblemError(404, 'not-found', 'Recording not found');
  }

  const segments = db
    .select()
    .from(recordingSegments)
    .where(eq(recordingSegments.recordingId, recordingId))
    .orderBy(recordingSegments.index)
    .all();
  const files = db.select().from(recordingFiles).where(eq(recordingFiles.recordingId, recordingId)).orderBy(recordingFiles.id).all();

  return {
    ...toRecordingPayload(row),
    segments: segments.map(toSegmentPayload),
    files: files.map(toFilePayload),
  };
}
