import {
  zCommandAccepted, zExportJob, zPage, zRecording, zRecordingDetail, zUsbVolume,
  type CommandAccepted, type ExportCreateRequest, type ExportJob,
  type Page, type Recording, type RecordingDetail, type RecordingFile,
  type RecordingSegment, type RecordingState, type Ulid, type UsbVolume,
} from '@eduscope/shared';
import { ProblemError } from '../../errors.js';
import { RESOLVE_BY_SEC } from '../commands.js';
import { validated, nowIsoZ, seedId } from '../seed/index.js';
import { nextUlid } from '../world.js';
import { currentUser, isAdmin, requireAdmin } from './auth.js';
import type { RestContext } from './index.js';

const DEFAULT_LIMIT = 20;

/** No dedicated fixture holds segments/files (RecordingDetail-only fields); derive one plausible pair from the summary row. */
function deriveDetail(r: Recording): RecordingDetail {
  const segmentId = seedId('segment');
  const segment: RecordingSegment = {
    id: segmentId,
    recordingId: r.id,
    index: 0,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    durationMs: r.durationMs,
    endReason: r.state === 'failed' ? 'crash' : 'stop',
    state: r.state === 'failed' ? 'failed' : 'finalized',
  };
  const file: RecordingFile = {
    id: seedId('file'),
    recordingId: r.id,
    segmentId,
    kind: 'merged',
    streamKey: 'main',
    container: 'mp4',
    sizeBytes: r.totalBytes,
    durationMs: r.durationMs,
    state: r.state === 'ready' ? 'finalized' : r.state === 'failed' ? 'missing' : 'writing',
    hasAudio: true,
    isUploadable: r.state === 'ready',
  };
  return { ...r, segments: [segment], files: [file] };
}

export function createRecordingsOperations(ctx: RestContext) {
  const { world, engine, seed } = ctx;

  return {
    listRecordings: async (query?: {
      cursor?: string;
      limit?: number;
      state?: RecordingState;
      includeDeleted?: boolean;
      q?: string;
      ownerUserId?: Ulid;
    }): Promise<Page<Recording>> => {
      const me = currentUser(ctx);
      const admin = isAdmin(ctx);
      const includeDeleted = admin && (query?.includeDeleted ?? false);

      // C-1: ownership is the SERVER's filter, never the client's — a lecturer's
      // page is already scoped, so the `ownerUserId` param is honoured for admins
      // only and ignored for a lecturer (CG-5).
      let rows = seed.recordings.filter((r) => admin || r.ownerUserId === me.id);
      if (!includeDeleted) rows = rows.filter((r) => r.state !== 'deleted');
      if (query?.state) rows = rows.filter((r) => r.state === query.state);
      if (admin && query?.ownerUserId) {
        rows = rows.filter((r) => r.ownerUserId === query.ownerUserId);
      }
      if (query?.q) {
        const needle = query.q.toLowerCase();
        rows = rows.filter((r) => r.title.toLowerCase().includes(needle));
      }

      const limit = query?.limit ?? DEFAULT_LIMIT;
      const start = query?.cursor ? Number.parseInt(query.cursor, 10) : 0;
      const page = rows.slice(start, start + limit);
      const nextCursor = start + limit < rows.length ? String(start + limit) : null;

      return validated(zPage(zRecording), { items: page, nextCursor });
    },

    getRecording: async (recordingId: Ulid): Promise<RecordingDetail> => {
      const row = seed.recordings.find((r) => r.id === recordingId);
      if (!row) throw new ProblemError({ status: 404, code: 'not-found', title: `Unknown recording: ${recordingId}` });
      return validated(zRecordingDetail, deriveDetail(row));
    },

    // x-required-role: admin (RA-06) — soft-delete is an admin-only, audited act.
    deleteRecording: async (recordingId: Ulid): Promise<CommandAccepted> => {
      requireAdmin(ctx);
      const refusal = engine.onCommand('deleteRecording');
      if (refusal) throw new ProblemError(refusal);
      const row = seed.recordings.find((r) => r.id === recordingId);
      if (!row) throw new ProblemError({ status: 404, code: 'not-found', title: `Unknown recording: ${recordingId}` });
      row.state = 'deleted';
      row.deletedAt = nowIsoZ(world.clock);
      row.deleteReason = 'admin';
      return validated(zCommandAccepted, {
        commandId: nextUlid(world),
        acceptedAt: nowIsoZ(world.clock),
        resolveBySec: RESOLVE_BY_SEC,
      });
    },

    // x-required-role: admin (RA-07, CG-7) — the only manual merge control; merging
    // is otherwise automatic (A-12, SM-D-1). 409 unless the recording is `failed`.
    retryMergeRecording: async (recordingId: Ulid): Promise<CommandAccepted> => {
      requireAdmin(ctx);
      const refusal = engine.onCommand('retryMergeRecording');
      if (refusal) throw new ProblemError(refusal);
      const row = seed.recordings.find((r) => r.id === recordingId);
      if (!row) throw new ProblemError({ status: 404, code: 'not-found', title: `Unknown recording: ${recordingId}` });
      if (row.mergeState !== 'failed') {
        throw new ProblemError({
          status: 409,
          code: 'conflict',
          title: 'This recording is not in a failed merge state',
        });
      }
      // RA-07 resets the attempt counter and re-runs machine 1b; the recording
      // returns to `merging` and resolves on recording.artifact{merging}.
      row.state = 'merging';
      row.mergeState = 'running';
      return validated(zCommandAccepted, {
        commandId: nextUlid(world),
        acceptedAt: nowIsoZ(world.clock),
        resolveBySec: RESOLVE_BY_SEC,
      });
    },

    getRecordingMedia: async (
      recordingId: Ulid,
      fileId: Ulid,
      query?: { download?: boolean },
    ): Promise<Blob> => {
      const row = seed.recordings.find((r) => r.id === recordingId);
      if (!row) throw new ProblemError({ status: 404, code: 'not-found', title: `Unknown recording: ${recordingId}` });
      void fileId;
      void query;
      return new Blob([`mock media bytes for ${recordingId}`], { type: 'video/mp4' });
    },

    listExportTargets: async (): Promise<UsbVolume[]> =>
      seed.usbVolumes.map((v) => validated(zUsbVolume, v)),

    createExport: async (body: ExportCreateRequest): Promise<ExportJob> => {
      const refusal = engine.onCommand('createExport');
      if (refusal) throw new ProblemError(refusal);
      const target = seed.usbVolumes.find((v) => v.devicePath === body.targetDevicePath);
      if (!target) {
        throw new ProblemError({ status: 422, code: 'export.invalid-target', title: 'That drive is no longer connected' });
      }
      const bytesTotal = body.recordingIds.reduce((sum, id) => {
        const r = seed.recordings.find((x) => x.id === id);
        return sum + (r?.totalBytes ?? 0);
      }, 0);
      // CG-21 / EXP-D-5: the server is the authoritative backstop for the
      // listing→copy race. The client pre-checks per-card (C-6), but a drive can
      // fill between listing and copy, so a target without room is refused with a
      // NAMED reason U-5 can render, not a generic validation.invalid.
      if (target.freeBytes < bytesTotal) {
        throw new ProblemError({
          status: 422,
          code: 'export.insufficient-space',
          title: 'That drive filled up — free space or pick another',
          detail: `Needs ${bytesTotal} bytes; ${target.label} has ${target.freeBytes} free.`,
        });
      }
      const job = validated(zExportJob, {
        id: nextUlid(world),
        requestedAt: nowIsoZ(world.clock),
        targetVolume: target,
        recordingIds: body.recordingIds,
        bytesTotal,
        bytesCopied: 0,
        state: 'queued',
        error: null,
      });
      seed.exportJobs.push(job);
      return job;
    },

    getExport: async (exportId: Ulid): Promise<ExportJob> => {
      const job = seed.exportJobs.find((j) => j.id === exportId);
      if (!job) throw new ProblemError({ status: 404, code: 'not-found', title: `Unknown export: ${exportId}` });
      return validated(zExportJob, job);
    },

    cancelExport: async (exportId: Ulid): Promise<CommandAccepted> => {
      const refusal = engine.onCommand('cancelExport');
      if (refusal) throw new ProblemError(refusal);
      const job = seed.exportJobs.find((j) => j.id === exportId);
      if (!job) throw new ProblemError({ status: 404, code: 'not-found', title: `Unknown export: ${exportId}` });
      if (job.state !== 'queued' && job.state !== 'copying') {
        throw new ProblemError({ status: 409, code: 'conflict', title: 'Export already finished' });
      }
      job.state = 'cancelled';
      return validated(zCommandAccepted, {
        commandId: nextUlid(world),
        acceptedAt: nowIsoZ(world.clock),
        resolveBySec: RESOLVE_BY_SEC,
      });
    },
  };
}
