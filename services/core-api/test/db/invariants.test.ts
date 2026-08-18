import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UlidGenerator } from '../../src/lib/ids.js';
import { openDatabase, type CoreDatabase } from '../../src/db/client.js';
import { migrate } from '../../src/db/migrate.js';
import { seed } from '../../src/db/seeds.js';
import { SerialWriter } from '../../src/db/writer.js';
import {
  answerProjections,
  lectureSessions,
  questionOptions,
  questionPublications,
  questions,
  quizSessionProjections,
  recordingFiles,
  recordings,
  storageVolumes,
  uploadFileParts,
  uploadJobs,
  users,
} from '../../src/db/schema.js';

const NOW = '2026-01-01T00:00:00.000+00:00';

function isConstraintError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (/constraint failed/i.test(error.message)) return true;
  return error.cause instanceof Error && /constraint failed/i.test(error.cause.message);
}

describe('database invariants (design/core-api.md §3.2)', () => {
  let dir: string;
  let core: CoreDatabase;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'core-api-invariants-'));
    core = openDatabase(join(dir, 'core.db'));
    migrate(core);
    seed(core, new Date(NOW), new UlidGenerator());
  });

  afterEach(() => {
    core.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function insertUser(id: string): void {
    core.db
      .insert(users)
      .values({
        id,
        username: id,
        displayName: id,
        role: 'lecturer',
        source: 'local',
        mustResetPassword: false,
        disabled: false,
        createdAt: NOW,
      })
      .run();
  }

  function insertLectureSession(
    id: string,
    ownerUserId: string,
    deviceId: string,
    state: 'starting' | 'recording' | 'paused' | 'stopping' | 'finalizing' | 'completed' | 'error',
  ): void {
    core.db
      .insert(lectureSessions)
      .values({
        id,
        title: `Lecture ${id}`,
        hallCode: 'HALL-1',
        hallDisplayName: 'Hall 1',
        deviceId,
        ownerUserId,
        startedByActor: 'user',
        state,
        startedAt: NOW,
        pauseCount: 0,
        channelActivations: [],
        sourceSnapshot: {},
        aiEnabledAtStart: false,
      })
      .run();
  }

  function insertRecording(id: string, sessionId: string, ownerUserId: string): void {
    core.db
      .insert(recordings)
      .values({
        id,
        sessionId,
        ownerUserId,
        state: 'ready',
        layoutPresetId: 'pc-only',
        segmentCount: 1,
        mergeState: 'not-needed',
        retentionDeleteAfter: NOW,
        playbackAuthRequired: true,
      })
      .run();
  }

  function insertRecordingFile(id: string, recordingId: string): void {
    core.db
      .insert(recordingFiles)
      .values({
        id,
        recordingId,
        kind: 'merged',
        streamKey: 'main',
        path: `/media/${id}.mp4`,
        container: 'mp4',
        state: 'finalized',
        hasAudio: true,
        isUploadable: true,
      })
      .run();
  }

  function insertQuestion(id: string, sessionId: string): void {
    core.db
      .insert(questions)
      .values({
        id,
        sessionId,
        kind: 'mcq',
        prompt: `Question ${id}`,
        provenance: 'lecturer-authored',
        edited: false,
        state: 'sent',
        createdAt: NOW,
      })
      .run();
  }

  function insertQuestionOption(id: string, questionId: string): void {
    core.db
      .insert(questionOptions)
      .values({ id, questionId, label: 'A', text: 'Option A', position: 0 })
      .run();
  }

  function insertQuizSessionProjection(id: string, lectureSessionId: string): void {
    core.db
      .insert(quizSessionProjections)
      .values({
        id,
        lectureSessionId,
        deviceId: 'device-1',
        hallDisplayName: 'Hall 1',
        state: 'open',
      })
      .run();
  }

  function insertQuestionPublication(id: string, questionId: string, quizSessionId: string, isShowing: boolean): void {
    core.db
      .insert(questionPublications)
      .values({
        id,
        questionId,
        quizSessionId,
        state: 'open',
        isShowing,
        projectorState: 'showing',
        syncState: 'synced',
      })
      .run();
  }

  describe('races — exactly one contender wins (partial unique indexes)', () => {
    it('one_active_session: a second non-terminal lecture_sessions.device_id loses', async () => {
      insertUser('user-a');
      const writer = new SerialWriter();

      const results = await Promise.allSettled([
        writer.run('start-1', () => insertLectureSession('session-1', 'user-a', 'device-1', 'recording')),
        writer.run('start-2', () => insertLectureSession('session-2', 'user-a', 'device-1', 'recording')),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected');
      expect(rejected).toBeDefined();
      expect(isConstraintError((rejected as PromiseRejectedResult).reason)).toBe(true);

      const rows = core.db.select().from(lectureSessions).all();
      expect(rows).toHaveLength(1);
    });

    it('one_showing_publication: a second showing publication per quiz session loses', async () => {
      insertUser('user-a');
      insertLectureSession('session-1', 'user-a', 'device-1', 'recording');
      insertQuizSessionProjection('quiz-1', 'session-1');
      insertQuestion('question-1', 'session-1');
      insertQuestion('question-2', 'session-1');
      const writer = new SerialWriter();

      const results = await Promise.allSettled([
        writer.run('pub-1', () => insertQuestionPublication('pub-1', 'question-1', 'quiz-1', true)),
        writer.run('pub-2', () => insertQuestionPublication('pub-2', 'question-2', 'quiz-1', true)),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected');
      expect(rejected).toBeDefined();
      expect(isConstraintError((rejected as PromiseRejectedResult).reason)).toBe(true);

      const showing = core.db.select().from(questionPublications).all().filter((row) => row.isShowing);
      expect(showing).toHaveLength(1);
    });

    it('one_recordings_volume: a second mounted recordings volume loses', async () => {
      const writer = new SerialWriter();

      function insertVolume(id: string, uuid: string) {
        core.db
          .insert(storageVolumes)
          .values({
            id,
            uuid,
            devicePath: `/dev/${id}`,
            mountPath: `/media/${id}`,
            filesystem: 'ext4',
            capacityBytes: 1_000_000_000,
            freeBytes: 500_000_000,
            smartStatus: 'good',
            role: 'recordings',
            state: 'mounted',
            registeredAt: NOW,
          })
          .run();
      }

      const results = await Promise.allSettled([
        writer.run('vol-1', () => insertVolume('vol-1', 'uuid-1')),
        writer.run('vol-2', () => insertVolume('vol-2', 'uuid-2')),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected');
      expect(rejected).toBeDefined();
      expect(isConstraintError((rejected as PromiseRejectedResult).reason)).toBe(true);

      const mounted = core.db
        .select()
        .from(storageVolumes)
        .all()
        .filter((row) => row.role === 'recordings' && row.state === 'mounted');
      expect(mounted).toHaveLength(1);
    });

    it('one_upload_job_per_recording: a second upload job for the same recording loses', async () => {
      insertUser('user-a');
      insertLectureSession('session-1', 'user-a', 'device-1', 'completed');
      insertRecording('recording-1', 'session-1', 'user-a');
      const writer = new SerialWriter();

      function insertUploadJob(id: string) {
        core.db
          .insert(uploadJobs)
          .values({
            id,
            recordingId: 'recording-1',
            adapterId: 'placeholder',
            state: 'queued',
            attempt: 0,
            metadata: {},
            enqueuedAt: NOW,
            remoteCleanupState: 'not-needed',
          })
          .run();
      }

      const results = await Promise.allSettled([
        writer.run('job-1', () => insertUploadJob('job-1')),
        writer.run('job-2', () => insertUploadJob('job-2')),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected');
      expect(rejected).toBeDefined();
      expect(isConstraintError((rejected as PromiseRejectedResult).reason)).toBe(true);

      const rows = core.db.select().from(uploadJobs).all();
      expect(rows).toHaveLength(1);
    });
  });

  describe('direct duplicate inserts fail', () => {
    it('rejects a second quiz_session_projections.lecture_session_id', () => {
      insertUser('user-a');
      insertLectureSession('session-1', 'user-a', 'device-1', 'recording');
      insertQuizSessionProjection('quiz-1', 'session-1');

      expect(() => insertQuizSessionProjection('quiz-2', 'session-1')).toThrow(/constraint failed/i);
    });

    it('rejects a second storage_volumes.uuid', () => {
      core.db
        .insert(storageVolumes)
        .values({
          id: 'vol-1',
          uuid: 'uuid-dup',
          devicePath: '/dev/vol-1',
          mountPath: '/media/vol-1',
          filesystem: 'ext4',
          capacityBytes: 1_000_000_000,
          freeBytes: 500_000_000,
          smartStatus: 'good',
          role: 'system',
          state: 'registered',
          registeredAt: NOW,
        })
        .run();

      expect(() =>
        core.db
          .insert(storageVolumes)
          .values({
            id: 'vol-2',
            uuid: 'uuid-dup',
            devicePath: '/dev/vol-2',
            mountPath: '/media/vol-2',
            filesystem: 'ext4',
            capacityBytes: 1_000_000_000,
            freeBytes: 500_000_000,
            smartStatus: 'good',
            role: 'system',
            state: 'registered',
            registeredAt: NOW,
          })
          .run(),
      ).toThrow(/constraint failed/i);
    });

    it('rejects a second upload_file_parts (upload_job_id, recording_file_id) pair', () => {
      insertUser('user-a');
      insertLectureSession('session-1', 'user-a', 'device-1', 'completed');
      insertRecording('recording-1', 'session-1', 'user-a');
      insertRecordingFile('file-1', 'recording-1');
      core.db
        .insert(uploadJobs)
        .values({
          id: 'job-1',
          recordingId: 'recording-1',
          adapterId: 'placeholder',
          state: 'queued',
          attempt: 0,
          metadata: {},
          enqueuedAt: NOW,
          remoteCleanupState: 'not-needed',
        })
        .run();

      function insertPart(id: string) {
        core.db
          .insert(uploadFileParts)
          .values({
            id,
            uploadJobId: 'job-1',
            recordingFileId: 'file-1',
            streamKey: 'main',
            state: 'pending',
            bytesTotal: 1000,
            bytesSent: 0,
            attempt: 0,
          })
          .run();
      }

      insertPart('part-1');
      expect(() => insertPart('part-2')).toThrow(/constraint failed/i);
    });

    it('rejects a second answer_projections (publication_id, student_id_number) pair', () => {
      insertUser('user-a');
      insertLectureSession('session-1', 'user-a', 'device-1', 'recording');
      insertQuizSessionProjection('quiz-1', 'session-1');
      insertQuestion('question-1', 'session-1');
      insertQuestionOption('option-1', 'question-1');
      insertQuestionPublication('pub-1', 'question-1', 'quiz-1', true);

      function insertAnswer(id: string) {
        core.db
          .insert(answerProjections)
          .values({
            id,
            publicationId: 'pub-1',
            studentIdNumber: 'student-1',
            studentDisplayName: 'Student One',
            selectedOptionId: 'option-1',
            isCorrect: true,
            responseTimeMs: 1000,
            submittedAt: NOW,
            syncedAt: NOW,
          })
          .run();
      }

      insertAnswer('answer-1');
      expect(() => insertAnswer('answer-2')).toThrow(/constraint failed/i);
    });
  });
});
