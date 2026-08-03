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

/** Six rows spanning ready/merging/failed so the library badge vocabulary is exercised. */
export function createRecordingsSeed(users: User[]): RecordingsSeed {
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
  ].map((row) => {
    const detail = { ...row, parts: row.parts.map((p) => ({ ...p, uploadJobId: row.id })) };
    validated(zUploadJob, detail); // the base shape must independently validate too
    return validated(zUploadJobDetail, detail);
  });

  const usbVolumes = [
    {
      devicePath: '/dev/sdb1',
      mountPath: '/media/usb0',
      label: 'BACKUP-1',
      capacityBytes: 64_000_000_000,
      freeBytes: 40_000_000_000,
    },
  ].map((row) => validated(zUsbVolume, row));

  const exportJobs: ExportJob[] = [];

  return { recordings, uploadJobs: uploadJobRows, exportJobs, usbVolumes };
}
