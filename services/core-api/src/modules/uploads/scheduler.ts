import { existsSync, createReadStream } from 'node:fs';
import type { Readable } from 'node:stream';
import { and, asc, eq, ne } from 'drizzle-orm';
import type { UploadFailureClass, UploadMetadata } from '@eduscope/shared';
import type { DrizzleDb } from '../../db/client.js';
import { recordingFiles, uploadFileParts, uploadJobs } from '../../db/schema.js';
import type { Cancel, Clock } from '../../lib/clock.js';
import type { DomainBus, Unsubscribe } from '../../lib/domain-bus.js';
import type { IdGenerator } from '../../lib/ids.js';
import type { LifecycleComponent } from '../../lifecycle.js';
import { UploadMachine } from './machine.js';

export interface UploadAdapterPart { recordingFileId: string; streamKey: string; bytesTotal: number; checksum: string | null }
export interface UploadCheckpoint { bytesSent: number; resumeToken: string | null; remoteFileId: string | null }
export interface UploadAdapter {
  readonly id: string;
  createLecture(metadata: UploadMetadata): Promise<{ remoteLectureId: string }>;
  uploadPart(input: { remoteLectureId: string; part: UploadAdapterPart; stream: Readable; resumeToken: string | null; onCheckpoint(checkpoint: UploadCheckpoint): void }): Promise<{ remoteFileId: string; checksum: string | null }>;
  completeLecture(remoteLectureId: string): Promise<void>;
  deleteLecture(remoteLectureId: string): Promise<void>;
}

interface FailureLike extends Error { failureClass?: UploadFailureClass }
export interface UploadSchedulerDeps { db: DrizzleDb; clock: Clock; ids: IdGenerator; bus: DomainBus; adapter?: UploadAdapter; random?: () => number; sourceStream?: (path: string) => Readable; logger?: { warn(message: string, meta?: unknown): void } }

export class UploadScheduler implements LifecycleComponent {
  readonly name = 'upload-scheduler';
  readonly machine: UploadMachine;
  readonly #sourceStream: (path: string) => Readable;
  #timer?: Cancel;
  #unsubscribes: Unsubscribe[] = [];
  #running = false;
  #stopping = false;

  constructor(readonly deps: UploadSchedulerDeps) {
    this.machine = new UploadMachine(deps);
    this.#sourceStream = deps.sourceStream ?? ((path) => createReadStream(path));
  }

  async start(): Promise<void> {
    this.#stopping = false;
    this.machine.recoverInterrupted();
    this.#unsubscribes.push(
      this.deps.bus.subscribe('artifact.ready', ({ recordingId }) => { this.machine.enqueue(recordingId); this.wake(); }),
      this.deps.bus.subscribe('recording.artifact', ({ recordingId, state }) => { if (state === 'deleted') this.machine.cancelDeleted(recordingId); }),
    );
    this.#timer = this.deps.clock.every(5_000, () => { this.machine.ensureOfflineAlert(); this.wake(); });
    this.wake();
  }

  async stop(): Promise<void> {
    this.#stopping = true;
    this.#timer?.cancel();
    for (const unsubscribe of this.#unsubscribes.splice(0)) unsubscribe();
    while (this.#running) await new Promise((resolve) => setTimeout(resolve, 5));
  }

  wake(): void {
    if (this.#running || this.#stopping || !this.deps.adapter) return;
    this.#running = true;
    void this.#drain().finally(() => { this.#running = false; if (!this.#stopping && this.machine.dueJob()) this.wake(); });
  }

  async #drain(): Promise<void> {
    const job = this.machine.dueJob();
    if (!job || !this.deps.adapter) return;
    try {
      if (job.remoteCleanupState === 'pending' && job.remoteLectureId) {
        await this.deps.adapter.deleteLecture(job.remoteLectureId);
        this.deps.db.update(uploadJobs).set({ remoteCleanupState: 'done', remoteLectureId: null }).where(eq(uploadJobs.id, job.id)).run();
        job.remoteLectureId = null;
      }
      let remoteLectureId = job.remoteLectureId;
      if (!remoteLectureId) {
        const created = await this.deps.adapter.createLecture(job.metadata as UploadMetadata);
        remoteLectureId = created.remoteLectureId;
      }
      this.machine.markUploading(job.id, remoteLectureId);
      const parts = this.deps.db.select().from(uploadFileParts).where(and(eq(uploadFileParts.uploadJobId, job.id), ne(uploadFileParts.state, 'uploaded'))).orderBy(asc(uploadFileParts.id)).all();
      for (const part of parts) {
        if (this.#stopping) return;
        const file = this.deps.db.select().from(recordingFiles).where(eq(recordingFiles.id, part.recordingFileId)).get();
        if (!file || file.state === 'missing' || file.state === 'deleted' || !existsSync(file.path)) { this.machine.missing(job.id, part.id, file?.path ?? part.recordingFileId); return; }
        this.machine.markPartUploading(part.id);
        const result = await this.deps.adapter.uploadPart({
          remoteLectureId,
          part: { recordingFileId: part.recordingFileId, streamKey: part.streamKey, bytesTotal: Number(part.bytesTotal), checksum: part.checksum },
          stream: this.#sourceStream(file.path),
          resumeToken: part.resumeToken,
          onCheckpoint: (checkpoint) => this.machine.checkpoint(part.id, checkpoint.bytesSent, checkpoint.resumeToken, checkpoint.remoteFileId),
        });
        this.machine.markPartUploaded(part.id, result.remoteFileId, result.checksum);
      }
      this.machine.markCompleting(job.id);
      await this.deps.adapter.completeLecture(remoteLectureId);
      this.machine.markDone(job.id);
    } catch (error) {
      const failure = error as FailureLike;
      const failureClass: UploadFailureClass = failure.failureClass ?? 'server';
      this.machine.fail(job.id, failureClass, failure.message || 'upload failed');
      this.deps.logger?.warn('upload attempt failed', { jobId: job.id, failureClass, error: failure.message });
    }
  }
}
