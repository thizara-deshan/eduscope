import { unlinkSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import type { CommandAccepted, RecordingArtifactPayload } from '@eduscope/shared';
import { TIMERS } from '@eduscope/shared';
import { eq } from 'drizzle-orm';
import { ProblemError } from '../../contracts/problem.js';
import type { DrizzleDb } from '../../db/client.js';
import { auditLogEntries, recordingFiles, recordings, uploadJobs } from '../../db/schema.js';
import type { Clock } from '../../lib/clock.js';
import type { DomainBus } from '../../lib/domain-bus.js';
import type { IdGenerator } from '../../lib/ids.js';
import type { AuthContext } from '../auth/service.js';
import type { ArtifactExecutor } from './merge-worker.js';
import { ArtifactRetryNotAllowedError } from './artifact-machine.js';

const NON_TERMINAL_UPLOAD_STATES = new Set(['queued', 'uploading', 'completing']);

export interface LibraryDeleteDeps {
  db: DrizzleDb;
  clock: Clock;
  ids: IdGenerator;
  bus: DomainBus;
  recordingsRoot: string;
  artifactExecutor: ArtifactExecutor;
  logger?: { warn(message: string, meta?: Record<string, unknown>): void };
}

function commandAccepted(clock: Clock, ids: IdGenerator): CommandAccepted {
  const now = clock.now();
  return { commandId: ids.next(now), acceptedAt: now.toISOString(), resolveBySec: TIMERS['T-CMD-RESOLVE'] / 1000 };
}

/** Only paths that resolve at or below the active recordings mount are ever touched — a defense against a corrupted/foreign `recording_files.path` row. */
function isUnderMount(recordingsRoot: string, path: string): boolean {
  const root = resolve(recordingsRoot);
  const target = resolve(path);
  return target === root || target.startsWith(root + sep);
}

/**
 * RA-06 (openapi.yaml deleteRecording, KEEP B-33): admin-only, audited with a
 * real actor, `LectureSession` survives (INV-LS-7). File removal happens
 * outside any transaction; the terminal rows/audit commit together after.
 * Idempotent — a second call against an already-deleted recording is a no-op
 * that returns the same acceptance shape.
 */
export function deleteRecording(deps: LibraryDeleteDeps, recordingId: string, actor: AuthContext): CommandAccepted {
  if (actor.role !== 'admin') {
    throw new ProblemError(403, 'not-authorized', 'Only an admin may delete a recording');
  }

  const { db, clock, ids, bus, recordingsRoot } = deps;
  const recording = db.select().from(recordings).where(eq(recordings.id, recordingId)).get();
  if (!recording) {
    throw new ProblemError(404, 'not-found', 'Recording not found');
  }

  if (recording.state === 'deleted') {
    return commandAccepted(clock, ids);
  }

  const files = db.select().from(recordingFiles).where(eq(recordingFiles.recordingId, recordingId)).all();
  for (const file of files) {
    if (file.state === 'deleted') continue;
    if (!isUnderMount(recordingsRoot, file.path)) continue;
    try {
      unlinkSync(file.path);
    } catch {
      // already missing on disk — the row is still marked deleted below.
    }
  }

  const now = clock.now();
  const nowIso = now.toISOString();

  db.transaction((tx) => {
    tx.update(recordingFiles).set({ state: 'deleted' }).where(eq(recordingFiles.recordingId, recordingId)).run();
    tx.update(recordings)
      .set({ state: 'deleted', deletedAt: nowIso, deletedBy: actor.userId, deleteReason: 'admin' })
      .where(eq(recordings.id, recordingId))
      .run();

    const activeUpload = tx.select().from(uploadJobs).where(eq(uploadJobs.recordingId, recordingId)).get();
    if (activeUpload && NON_TERMINAL_UPLOAD_STATES.has(activeUpload.state)) {
      tx.update(uploadJobs).set({ state: 'cancelled' }).where(eq(uploadJobs.id, activeUpload.id)).run();
    }

    tx.insert(auditLogEntries)
      .values({
        id: ids.next(now),
        at: nowIso,
        actorUserId: actor.userId,
        actorKind: 'user',
        entityType: 'recording',
        entityId: recordingId,
        action: 'delete',
        sessionId: recording.sessionId,
        before: { state: recording.state },
        after: { state: 'deleted' },
        reason: null,
      })
      .run();
  });

  const payload: RecordingArtifactPayload = {
    recordingId,
    sessionId: recording.sessionId,
    state: 'deleted',
    mergeState: recording.mergeState,
    durationMs: recording.durationMs ?? null,
    totalBytes: recording.totalBytes ?? null,
    deleteReason: 'admin',
  };
  bus.publish('recording.artifact', payload);

  return commandAccepted(clock, ids);
}

/**
 * RA-07 (openapi.yaml retryMergeRecording): admin-only, 409 unless the
 * recording is `failed`. 202 is acceptance, not completion — the merge runs
 * in the background through the same `ArtifactExecutor` B-13 wired to the
 * finalized-recording event; this call is the manual re-entry point only.
 */
export function retryMergeRecording(deps: LibraryDeleteDeps, recordingId: string, actor: AuthContext): CommandAccepted {
  if (actor.role !== 'admin') {
    throw new ProblemError(403, 'not-authorized', 'Only an admin may retry a merge');
  }

  const { db, clock, ids, artifactExecutor, logger } = deps;
  const recording = db.select().from(recordings).where(eq(recordings.id, recordingId)).get();
  if (!recording) {
    throw new ProblemError(404, 'not-found', 'Recording not found');
  }
  if (recording.state !== 'failed') {
    throw new ProblemError(409, 'conflict', 'Recording is not in a failed merge state');
  }

  artifactExecutor.retryMergeRecording(recordingId).catch((error: unknown) => {
    if (error instanceof ArtifactRetryNotAllowedError) return;
    logger?.warn('retryMergeRecording: background retry failed', {
      error: error instanceof Error ? error.message : String(error),
      recordingId,
    });
  });

  return commandAccepted(clock, ids);
}
