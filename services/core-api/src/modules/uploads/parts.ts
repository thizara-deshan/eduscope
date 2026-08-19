import type { UploadFilePart, UploadMetadata } from '@eduscope/shared';
import { and, eq } from 'drizzle-orm';
import type { DrizzleDb } from '../../db/client.js';
import { lectureSessions, recordingFiles, recordings, uploadFileParts } from '../../db/schema.js';

export function uploadableFiles(db: DrizzleDb, recordingId: string) {
  return db.select().from(recordingFiles).where(and(eq(recordingFiles.recordingId, recordingId), eq(recordingFiles.isUploadable, true))).all();
}

export function buildUploadMetadata(db: DrizzleDb, recordingId: string): UploadMetadata {
  const recording = db.select().from(recordings).where(eq(recordings.id, recordingId)).get();
  if (!recording) throw new Error(`recording ${recordingId} not found`);
  const session = db.select().from(lectureSessions).where(eq(lectureSessions.id, recording.sessionId)).get();
  if (!session?.endedAt) throw new Error(`recording ${recordingId} has no completed session`);
  return {
    title: session.title,
    hallCode: session.hallCode,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    recordedDurationMs: Number(session.recordedDurationMs ?? 0),
    files: uploadableFiles(db, recordingId).map((file) => ({
      streamKey: file.streamKey,
      sizeBytes: Number(file.sizeBytes ?? 0),
      durationMs: file.durationMs === null ? null : Number(file.durationMs),
      checksum: file.checksum,
    })),
  };
}

export function toUploadPart(row: typeof uploadFileParts.$inferSelect): UploadFilePart {
  return {
    id: row.id,
    uploadJobId: row.uploadJobId,
    recordingFileId: row.recordingFileId,
    streamKey: row.streamKey,
    state: row.state,
    bytesTotal: Number(row.bytesTotal),
    bytesSent: Number(row.bytesSent),
    attempt: row.attempt,
    lastError: row.lastError,
  };
}
