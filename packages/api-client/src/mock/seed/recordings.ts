import {
  zRecording, zUploadJob, zUploadJobDetail, zUsbVolume,
  type ExportJob, type Recording, type UploadJobDetail, type UsbVolume, type User,
} from '@eduscope/shared';
import { SEED_EPOCH, SEED_LECTURE_SESSION_ID, seedId, validated } from './index.js';

export interface RecordingsSeed {
  readonly recordings: Recording[];
  readonly uploadJobs: UploadJobDetail[];
  readonly exportJobs: ExportJob[];
  readonly usbVolumes: UsbVolume[];
}

const HOUR = 60 * 60_000;
const at = (offsetMs: number) => new Date(Date.parse(SEED_EPOCH) + offsetMs).toISOString();
const retentionDeleteAfter = (startedAtMs: number) => new Date(startedAtMs + 90 * 24 * HOUR).toISOString();

/** Two candidates so the picker must ask the user (never "the first drive", B-38 / EXP-D-1). One is deliberately too small for a multi-recording selection (C-6, CG-21). Listed even when `recordingsPresent:false` — the export flow still lists drives. */
function createUsbVolumesSeed(): UsbVolume[] {
  return [
    {
      devicePath: '/dev/sdb1',
      mountPath: '/media/usb0',
      label: 'BACKUP-1',
      capacityBytes: 64_000_000_000,
      freeBytes: 40_000_000_000,
    },
    {
      devicePath: '/dev/sdc1',
      mountPath: '/media/usb1',
      label: 'LECTURE-STICK',
      capacityBytes: 8_000_000_000,
      freeBytes: 900_000_000,
    },
  ].map((row) => validated(zUsbVolume, row));
}

/**
 * Eight rows spanning ready/merging/failed/deleted so the library badge
 * vocabulary is exercised, plus the two CG-20 upload-failure classes (offline vs
 * server) and two USB targets (one too small) for the CG-21 space refusal.
 */
export function createRecordingsSeed(
  users: User[],
  opts?: { recordingsPresent?: boolean },
): RecordingsSeed {
  if (opts?.recordingsPresent === false) {
    return { recordings: [], uploadJobs: [], exportJobs: [], usbVolumes: createUsbVolumesSeed() };
  }

  const lecturer = users.find((u) => u.username === 'a.perera')!;

  const rows: Recording[] = [
    {
      id: seedId('recording'),
      sessionId: SEED_LECTURE_SESSION_ID,
      title: 'CS2013 — Data Structures, Lecture 12',
      hallDisplayName: 'Engineering Auditorium A301',
      ownerUserId: lecturer.id,
      ownerDisplayName: lecturer.displayName,
      startedAt: at(-1 * HOUR),
      endedAt: at(-1 * HOUR + 48 * 60_000),
      state: 'ready',
      layoutPresetId: 'fifty-fifty',
      durationMs: 48 * 60_000,
      totalBytes: 1_450_000_000,
      segmentCount: 1,
      mergeState: 'done',
      uploadState: 'done',
      retentionDeleteAfter: retentionDeleteAfter(Date.parse(SEED_EPOCH) - 1 * HOUR),
      deletedAt: null,
      deleteReason: null,
    },
    {
      id: seedId('recording'),
      sessionId: seedId('session'),
      title: 'CS2013 — Data Structures, Lecture 11',
      hallDisplayName: 'Engineering Auditorium A301',
      ownerUserId: lecturer.id,
      ownerDisplayName: lecturer.displayName,
      startedAt: at(-25 * HOUR),
      endedAt: at(-25 * HOUR + 51 * 60_000),
      state: 'ready',
      layoutPresetId: 'fifty-fifty',
      durationMs: 51 * 60_000,
      totalBytes: 1_510_000_000,
      segmentCount: 2,
      mergeState: 'done',
      uploadState: 'uploading',
      retentionDeleteAfter: retentionDeleteAfter(Date.parse(SEED_EPOCH) - 25 * HOUR),
      deletedAt: null,
      deleteReason: null,
    },
    {
      id: seedId('recording'),
      sessionId: seedId('session'),
      title: 'CS2013 — Data Structures, Lecture 10',
      hallDisplayName: 'Engineering Auditorium A301',
      ownerUserId: lecturer.id,
      ownerDisplayName: lecturer.displayName,
      startedAt: at(-49 * HOUR),
      endedAt: at(-49 * HOUR + 46 * 60_000),
      state: 'ready',
      layoutPresetId: 'cams-fifty-fifty',
      durationMs: 46 * 60_000,
      totalBytes: 1_320_000_000,
      segmentCount: 1,
      mergeState: 'done',
      uploadState: 'dead-letter',
      retentionDeleteAfter: retentionDeleteAfter(Date.parse(SEED_EPOCH) - 49 * HOUR),
      deletedAt: null,
      deleteReason: null,
    },
    {
      id: seedId('recording'),
      sessionId: seedId('session'),
      title: 'CS2013 — Data Structures, Lecture 9',
      hallDisplayName: 'Engineering Auditorium A301',
      ownerUserId: lecturer.id,
      ownerDisplayName: lecturer.displayName,
      startedAt: at(-73 * HOUR),
      endedAt: at(-73 * HOUR + 50 * 60_000),
      state: 'merging',
      layoutPresetId: 'fifty-fifty',
      durationMs: 50 * 60_000,
      totalBytes: null,
      segmentCount: 3,
      mergeState: 'running',
      uploadState: null,
      retentionDeleteAfter: retentionDeleteAfter(Date.parse(SEED_EPOCH) - 73 * HOUR),
      deletedAt: null,
      deleteReason: null,
    },
    {
      id: seedId('recording'),
      sessionId: seedId('session'),
      title: 'CS2013 — Data Structures, Lecture 8',
      hallDisplayName: 'Engineering Auditorium A301',
      ownerUserId: lecturer.id,
      ownerDisplayName: lecturer.displayName,
      startedAt: at(-97 * HOUR),
      endedAt: at(-97 * HOUR + 6 * 60_000),
      state: 'failed',
      layoutPresetId: 'fifty-fifty',
      durationMs: null,
      totalBytes: null,
      segmentCount: 1,
      mergeState: 'failed',
      uploadState: null,
      retentionDeleteAfter: retentionDeleteAfter(Date.parse(SEED_EPOCH) - 97 * HOUR),
      deletedAt: null,
      deleteReason: null,
    },
    {
      id: seedId('recording'),
      sessionId: seedId('session'),
      title: 'CS2013 — Data Structures, Lecture 7',
      hallDisplayName: 'Engineering Auditorium A301',
      ownerUserId: lecturer.id,
      ownerDisplayName: lecturer.displayName,
      startedAt: at(-121 * HOUR),
      endedAt: at(-121 * HOUR + 44 * 60_000),
      state: 'deleted',
      layoutPresetId: 'pc-only',
      durationMs: 44 * 60_000,
      totalBytes: 1_180_000_000,
      segmentCount: 1,
      mergeState: 'done',
      uploadState: 'done',
      retentionDeleteAfter: retentionDeleteAfter(Date.parse(SEED_EPOCH) - 121 * HOUR),
      deletedAt: at(-2 * HOUR),
      deleteReason: 'retention',
    },
    // CG-20 — an OFFLINE upload: the device can't reach the upload server, so the
    // job is `failed`/`connectivity` and spends NO attempts (§4.4). S-35 must read
    // this as "Waiting for the network", never "attempt N of 8".
    {
      id: seedId('recording'),
      sessionId: seedId('session'),
      title: 'CS2013 — Data Structures, Lecture 6',
      hallDisplayName: 'Engineering Auditorium A301',
      ownerUserId: lecturer.id,
      ownerDisplayName: lecturer.displayName,
      startedAt: at(-145 * HOUR),
      endedAt: at(-145 * HOUR + 49 * 60_000),
      state: 'ready',
      layoutPresetId: 'fifty-fifty',
      durationMs: 49 * 60_000,
      totalBytes: 1_490_000_000,
      segmentCount: 1,
      mergeState: 'done',
      uploadState: 'failed',
      retentionDeleteAfter: retentionDeleteAfter(Date.parse(SEED_EPOCH) - 145 * HOUR),
      deletedAt: null,
      deleteReason: null,
    },
    // CG-20 — a SERVER-class failure that IS spending attempts and will dead-letter
    // at the cap: S-35 reads this as "Upload failed · attempt 3 of 8", the honest
    // counterpart the offline row must be distinguishable from.
    {
      id: seedId('recording'),
      sessionId: seedId('session'),
      title: 'CS2013 — Data Structures, Lecture 5',
      hallDisplayName: 'Engineering Auditorium A301',
      ownerUserId: lecturer.id,
      ownerDisplayName: lecturer.displayName,
      startedAt: at(-169 * HOUR),
      endedAt: at(-169 * HOUR + 47 * 60_000),
      state: 'ready',
      layoutPresetId: 'fifty-fifty',
      durationMs: 47 * 60_000,
      totalBytes: 1_430_000_000,
      segmentCount: 1,
      mergeState: 'done',
      uploadState: 'failed',
      retentionDeleteAfter: retentionDeleteAfter(Date.parse(SEED_EPOCH) - 169 * HOUR),
      deletedAt: null,
      deleteReason: null,
    },
  ];
  const recordings = rows.map((row) => validated(zRecording, row));

  const uploadJobRows: UploadJobDetail[] = [
    {
      id: seedId('upload'),
      recordingId: recordings[0]!.id,
      recordingTitle: recordings[0]!.title,
      adapterId: 'institute-lms',
      state: 'done',
      attempt: 1,
      failureClass: null,
      nextAttemptAt: null,
      lastError: null,
      lastErrorAt: null,
      remoteLectureId: 'lms-88213',
      progressPct: 100,
      blockedBy: null,
      enqueuedAt: recordings[0]!.endedAt!,
      startedAt: recordings[0]!.endedAt!,
      completedAt: at(-1 * HOUR + 55 * 60_000),
      requeuedAt: null,
      parts: [
        {
          id: seedId('upload-part'),
          uploadJobId: '',
          recordingFileId: seedId('file'),
          streamKey: 'main',
          state: 'uploaded',
          bytesTotal: 1_450_000_000,
          bytesSent: 1_450_000_000,
          attempt: 1,
          lastError: null,
        },
      ],
      metadata: {
        title: recordings[0]!.title,
        hallCode: 'ENG-A301',
        startedAt: recordings[0]!.startedAt,
        endedAt: recordings[0]!.endedAt!,
        recordedDurationMs: recordings[0]!.durationMs!,
        files: [{ streamKey: 'main', sizeBytes: 1_450_000_000, durationMs: recordings[0]!.durationMs, checksum: null }],
      },
    },
    {
      id: seedId('upload'),
      recordingId: recordings[1]!.id,
      recordingTitle: recordings[1]!.title,
      adapterId: 'institute-lms',
      state: 'uploading',
      attempt: 1,
      failureClass: null,
      nextAttemptAt: null,
      lastError: null,
      lastErrorAt: null,
      remoteLectureId: null,
      progressPct: 62,
      blockedBy: null,
      enqueuedAt: recordings[1]!.endedAt!,
      startedAt: recordings[1]!.endedAt!,
      completedAt: null,
      requeuedAt: null,
      parts: [
        {
          id: seedId('upload-part'),
          uploadJobId: '',
          recordingFileId: seedId('file'),
          streamKey: 'main',
          state: 'uploading',
          bytesTotal: 1_510_000_000,
          bytesSent: 936_000_000,
          attempt: 1,
          lastError: null,
        },
      ],
      metadata: {
        title: recordings[1]!.title,
        hallCode: 'ENG-A301',
        startedAt: recordings[1]!.startedAt,
        endedAt: recordings[1]!.endedAt!,
        recordedDurationMs: recordings[1]!.durationMs!,
        files: [{ streamKey: 'main', sizeBytes: 1_510_000_000, durationMs: recordings[1]!.durationMs, checksum: null }],
      },
    },
    {
      id: seedId('upload'),
      recordingId: recordings[2]!.id,
      recordingTitle: recordings[2]!.title,
      adapterId: 'institute-lms',
      state: 'dead-letter',
      attempt: 5,
      failureClass: 'server',
      nextAttemptAt: null,
      lastError: 'remote host returned 503 five times in a row',
      lastErrorAt: at(-40 * HOUR),
      remoteLectureId: null,
      progressPct: 0,
      blockedBy: null,
      enqueuedAt: recordings[2]!.endedAt!,
      startedAt: recordings[2]!.endedAt!,
      completedAt: null,
      requeuedAt: null,
      parts: [
        {
          id: seedId('upload-part'),
          uploadJobId: '',
          recordingFileId: seedId('file'),
          streamKey: 'main',
          state: 'failed',
          bytesTotal: 1_320_000_000,
          bytesSent: 0,
          attempt: 5,
          lastError: 'remote host returned 503 five times in a row',
        },
      ],
      metadata: {
        title: recordings[2]!.title,
        hallCode: 'ENG-A301',
        startedAt: recordings[2]!.startedAt,
        endedAt: recordings[2]!.endedAt!,
        recordedDurationMs: recordings[2]!.durationMs!,
        files: [{ streamKey: 'main', sizeBytes: 1_320_000_000, durationMs: recordings[2]!.durationMs, checksum: null }],
      },
    },
    // CG-20 offline: failed + connectivity, ZERO attempts spent (§4.4). Retries
    // at the 6 h cap; `nextAttemptAt` is set but no attempt is burned.
    {
      id: seedId('upload'),
      recordingId: recordings[6]!.id,
      recordingTitle: recordings[6]!.title,
      adapterId: 'institute-lms',
      state: 'failed',
      attempt: 0,
      failureClass: 'connectivity',
      nextAttemptAt: at(-1 * HOUR),
      lastError: 'connect timeout — no route to the upload server',
      lastErrorAt: at(-145 * HOUR + 55 * 60_000),
      remoteLectureId: null,
      progressPct: 0,
      blockedBy: null,
      enqueuedAt: recordings[6]!.endedAt!,
      startedAt: recordings[6]!.endedAt!,
      completedAt: null,
      requeuedAt: null,
      parts: [
        {
          id: seedId('upload-part'),
          uploadJobId: '',
          recordingFileId: seedId('file'),
          streamKey: 'main',
          state: 'pending',
          bytesTotal: 1_490_000_000,
          bytesSent: 0,
          attempt: 0,
          lastError: null,
        },
      ],
      metadata: {
        title: recordings[6]!.title,
        hallCode: 'ENG-A301',
        startedAt: recordings[6]!.startedAt,
        endedAt: recordings[6]!.endedAt!,
        recordedDurationMs: recordings[6]!.durationMs!,
        files: [{ streamKey: 'main', sizeBytes: 1_490_000_000, durationMs: recordings[6]!.durationMs, checksum: null }],
      },
    },
    // CG-20 server-class: failed + server, attempts ARE spending toward the cap.
    {
      id: seedId('upload'),
      recordingId: recordings[7]!.id,
      recordingTitle: recordings[7]!.title,
      adapterId: 'institute-lms',
      state: 'failed',
      attempt: 3,
      failureClass: 'server',
      nextAttemptAt: at(1 * HOUR),
      lastError: 'remote host returned 500',
      lastErrorAt: at(-169 * HOUR + 58 * 60_000),
      remoteLectureId: null,
      progressPct: 0,
      blockedBy: null,
      enqueuedAt: recordings[7]!.endedAt!,
      startedAt: recordings[7]!.endedAt!,
      completedAt: null,
      requeuedAt: null,
      parts: [
        {
          id: seedId('upload-part'),
          uploadJobId: '',
          recordingFileId: seedId('file'),
          streamKey: 'main',
          state: 'failed',
          bytesTotal: 1_430_000_000,
          bytesSent: 0,
          attempt: 3,
          lastError: 'remote host returned 500',
        },
      ],
      metadata: {
        title: recordings[7]!.title,
        hallCode: 'ENG-A301',
        startedAt: recordings[7]!.startedAt,
        endedAt: recordings[7]!.endedAt!,
        recordedDurationMs: recordings[7]!.durationMs!,
        files: [{ streamKey: 'main', sizeBytes: 1_430_000_000, durationMs: recordings[7]!.durationMs, checksum: null }],
      },
    },
  ].map((row) => {
    const detail = { ...row, parts: row.parts.map((p) => ({ ...p, uploadJobId: row.id })) };
    validated(zUploadJob, detail); // the base shape must independently validate too
    return validated(zUploadJobDetail, detail);
  });

  const usbVolumes = createUsbVolumesSeed();

  const exportJobs: ExportJob[] = [];

  return { recordings, uploadJobs: uploadJobRows, exportJobs, usbVolumes };
}
