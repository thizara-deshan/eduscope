import type { UploadFailureClass, UploadJob, UploadJobPayload, UploadMetadata, UploadPartPayload } from '@eduscope/shared';
import { and, asc, desc, eq, inArray, isNull, lte } from 'drizzle-orm';
import { ProblemError } from '../../contracts/problem.js';
import type { DrizzleDb } from '../../db/client.js';
import { recordings, systemAlerts, uploadFileParts, uploadJobs } from '../../db/schema.js';
import type { Clock } from '../../lib/clock.js';
import type { DomainBus } from '../../lib/domain-bus.js';
import type { IdGenerator } from '../../lib/ids.js';
import type { AuthContext } from '../auth/service.js';
import { buildUploadMetadata, toUploadPart, uploadableFiles } from './parts.js';

declare module '../../lib/domain-bus.js' {
  interface CoreDomainEvents {
    'upload.job': UploadJobPayload;
    'upload.part': UploadPartPayload;
  }
}

const RETRY_DELAYS = [30_000, 120_000, 480_000, 1_800_000, 7_200_000, 21_600_000] as const;
export function retryDelayMs(attempt: number, random: () => number): number {
  const base = RETRY_DELAYS[Math.min(Math.max(attempt, 1), RETRY_DELAYS.length) - 1]!;
  return Math.round(base * (0.8 + 0.4 * random()));
}

export interface UploadMachineDeps { db: DrizzleDb; clock: Clock; ids: IdGenerator; bus: DomainBus; random?: () => number }

export class UploadMachine {
  readonly #random: () => number;
  constructor(readonly deps: UploadMachineDeps) { this.#random = deps.random ?? Math.random; }

  enqueue(recordingId: string): string | null {
    const recording = this.deps.db.select().from(recordings).where(eq(recordings.id, recordingId)).get();
    if (!recording || recording.state !== 'ready' || recording.mergeState !== 'done') return null;
    const existing = this.deps.db.select().from(uploadJobs).where(eq(uploadJobs.recordingId, recordingId)).get();
    if (existing) return existing.id;
    const now = this.deps.clock.now();
    const id = this.deps.ids.next(now);
    const metadata = buildUploadMetadata(this.deps.db, recordingId);
    this.deps.db.transaction((tx) => {
      tx.insert(uploadJobs).values({ id, recordingId, adapterId: 'placeholder', state: 'queued', attempt: 0, nextAttemptAt: now.toISOString(), lastError: null, lastErrorAt: null, failureClass: null, blockedBy: null, remoteLectureId: null, metadata, enqueuedAt: now.toISOString(), startedAt: null, completedAt: null, requeuedBy: null, requeuedAt: null, remoteCleanupState: 'not-needed' }).run();
      for (const file of uploadableFiles(tx as DrizzleDb, recordingId)) {
        tx.insert(uploadFileParts).values({ id: this.deps.ids.next(now), uploadJobId: id, recordingFileId: file.id, streamKey: file.streamKey, state: 'pending', bytesTotal: Number(file.sizeBytes ?? 0), bytesSent: 0, resumeToken: null, remoteFileId: null, checksum: file.checksum, attempt: 0, lastError: null }).run();
      }
    });
    this.publishJob(id);
    return id;
  }

  dueJob() {
    return this.deps.db.select().from(uploadJobs).where(and(inArray(uploadJobs.state, ['queued', 'failed']), lte(uploadJobs.nextAttemptAt, this.deps.clock.now().toISOString()))).orderBy(asc(uploadJobs.enqueuedAt)).get();
  }

  recoverInterrupted(): void {
    const now = this.deps.clock.now().toISOString();
    this.deps.db.update(uploadJobs).set({ state: 'queued', nextAttemptAt: now }).where(inArray(uploadJobs.state, ['uploading', 'completing'])).run();
    this.deps.db.update(uploadFileParts).set({ state: 'pending' }).where(eq(uploadFileParts.state, 'uploading')).run();
  }

  markUploading(jobId: string, remoteLectureId: string): void {
    const now = this.deps.clock.now().toISOString();
    this.deps.db.update(uploadJobs).set({ state: 'uploading', remoteLectureId, startedAt: now, nextAttemptAt: null, failureClass: null, lastError: null, lastErrorAt: null }).where(eq(uploadJobs.id, jobId)).run();
    this.publishJob(jobId);
  }

  markPartUploading(partId: string): void {
    this.deps.db.update(uploadFileParts).set({ state: 'uploading' }).where(eq(uploadFileParts.id, partId)).run();
    this.publishPart(partId);
  }

  checkpoint(partId: string, bytesSent: number, resumeToken: string | null, remoteFileId: string | null): void {
    this.deps.db.update(uploadFileParts).set({ bytesSent, resumeToken, remoteFileId }).where(eq(uploadFileParts.id, partId)).run();
    this.publishPart(partId);
    const part = this.deps.db.select().from(uploadFileParts).where(eq(uploadFileParts.id, partId)).get();
    if (part) this.publishJob(part.uploadJobId);
  }

  markPartUploaded(partId: string, remoteFileId: string, checksum: string | null): void {
    const part = this.deps.db.select().from(uploadFileParts).where(eq(uploadFileParts.id, partId)).get();
    if (!part) return;
    this.deps.db.update(uploadFileParts).set({ state: 'uploaded', bytesSent: part.bytesTotal, remoteFileId, checksum, lastError: null }).where(eq(uploadFileParts.id, partId)).run();
    this.publishPart(partId);
  }

  markCompleting(jobId: string): void { this.deps.db.update(uploadJobs).set({ state: 'completing' }).where(eq(uploadJobs.id, jobId)).run(); this.publishJob(jobId); }
  markDone(jobId: string): void { this.deps.db.update(uploadJobs).set({ state: 'done', completedAt: this.deps.clock.now().toISOString(), nextAttemptAt: null, failureClass: null, lastError: null }).where(eq(uploadJobs.id, jobId)).run(); this.publishJob(jobId); }

  fail(jobId: string, failureClass: UploadFailureClass, message: string): void {
    const row = this.deps.db.select().from(uploadJobs).where(eq(uploadJobs.id, jobId)).get();
    if (!row) return;
    const spendAttempt = failureClass !== 'connectivity';
    const attempt = row.attempt + (spendAttempt ? 1 : 0);
    const dead = failureClass === 'permanent' ? attempt >= 2 : failureClass === 'server' ? attempt >= 8 : false;
    const now = this.deps.clock.now();
    const nextAttemptAt = dead ? null : new Date(now.getTime() + retryDelayMs(Math.max(attempt, 1), this.#random)).toISOString();
    this.deps.db.update(uploadJobs).set({ state: dead ? 'dead-letter' : 'failed', attempt, failureClass, lastError: message, lastErrorAt: now.toISOString(), nextAttemptAt }).where(eq(uploadJobs.id, jobId)).run();
    this.deps.db.update(uploadFileParts).set({ state: 'pending', lastError: message }).where(and(eq(uploadFileParts.uploadJobId, jobId), eq(uploadFileParts.state, 'uploading'))).run();
    this.publishJob(jobId);
  }

  missing(jobId: string, partId: string, path: string): void {
    this.deps.db.update(uploadFileParts).set({ state: 'missing', lastError: `missing local file: ${path}` }).where(eq(uploadFileParts.id, partId)).run();
    this.deps.db.update(uploadJobs).set({ state: 'dead-letter', failureClass: 'permanent', lastError: `missing local file: ${path}`, lastErrorAt: this.deps.clock.now().toISOString(), nextAttemptAt: null }).where(eq(uploadJobs.id, jobId)).run();
    this.publishPart(partId); this.publishJob(jobId);
  }

  cancelDeleted(recordingId: string): void {
    const row = this.deps.db.select().from(uploadJobs).where(eq(uploadJobs.recordingId, recordingId)).get();
    if (!row || row.state === 'done' || row.state === 'cancelled') return;
    this.deps.db.update(uploadJobs).set({ state: 'cancelled', nextAttemptAt: null }).where(eq(uploadJobs.id, row.id)).run();
    this.publishJob(row.id);
  }

  ensureOfflineAlert(): void {
    const cutoff = new Date(this.deps.clock.now().getTime() - 86_400_000).toISOString();
    const stalled = this.deps.db.select().from(uploadJobs).where(and(eq(uploadJobs.failureClass, 'connectivity'), lte(uploadJobs.lastErrorAt, cutoff))).get();
    if (!stalled) return;
    const open = this.deps.db.select().from(systemAlerts).where(and(eq(systemAlerts.code, 'upload.offline-24h'), isNull(systemAlerts.clearedAt))).get();
    if (!open) this.deps.db.insert(systemAlerts).values({ id: this.deps.ids.next(this.deps.clock.now()), code: 'upload.offline-24h', severity: 'warning', category: 'System', title: 'Uploads offline for 24 hours', detail: stalled.lastError, raisedAt: this.deps.clock.now().toISOString(), context: { jobId: stalled.id }, relatedEntity: { type: 'upload-job', id: stalled.id } }).run();
  }

  list(actor: AuthContext, state?: UploadJob['state']): { items: UploadJob[]; nextCursor: null } {
    this.#admin(actor);
    const rows = state ? this.deps.db.select().from(uploadJobs).where(eq(uploadJobs.state, state)).orderBy(desc(uploadJobs.enqueuedAt)).all() : this.deps.db.select().from(uploadJobs).orderBy(desc(uploadJobs.enqueuedAt)).all();
    return { items: rows.map((row) => this.toJob(row)), nextCursor: null };
  }
  get(actor: AuthContext, jobId: string) {
    this.#admin(actor);
    const row = this.deps.db.select().from(uploadJobs).where(eq(uploadJobs.id, jobId)).get();
    if (!row) throw new ProblemError(404, 'not-found', 'Upload job not found');
    return { ...this.toJob(row), parts: this.deps.db.select().from(uploadFileParts).where(eq(uploadFileParts.uploadJobId, jobId)).all().map(toUploadPart), metadata: row.metadata as UploadMetadata };
  }
  requeue(actor: AuthContext, jobId: string) {
    this.#admin(actor);
    const row = this.deps.db.select().from(uploadJobs).where(eq(uploadJobs.id, jobId)).get();
    if (!row) throw new ProblemError(404, 'not-found', 'Upload job not found');
    if (row.state !== 'dead-letter') throw new ProblemError(409, 'upload.not-requeueable', 'Upload job is not requeueable');
    const now = this.deps.clock.now();
    this.deps.db.update(uploadJobs).set({ state: 'queued', attempt: 0, nextAttemptAt: now.toISOString(), lastError: null, lastErrorAt: null, failureClass: null, blockedBy: null, completedAt: null, requeuedBy: actor.userId, requeuedAt: now.toISOString(), remoteCleanupState: row.remoteLectureId ? 'pending' : 'not-needed' }).where(eq(uploadJobs.id, jobId)).run();
    this.deps.db.update(uploadFileParts).set({ state: 'pending', attempt: 0, lastError: null }).where(eq(uploadFileParts.uploadJobId, jobId)).run();
    this.publishJob(jobId);
    return { commandId: this.deps.ids.next(now), acceptedAt: now.toISOString(), resolveBySec: 5 };
  }

  toJob(row: typeof uploadJobs.$inferSelect): UploadJob {
    const metadata = row.metadata as UploadMetadata;
    const parts = this.deps.db.select().from(uploadFileParts).where(eq(uploadFileParts.uploadJobId, row.id)).all();
    const total = parts.reduce((sum, p) => sum + Number(p.bytesTotal), 0);
    const sent = parts.reduce((sum, p) => sum + Number(p.bytesSent), 0);
    return { id: row.id, recordingId: row.recordingId, recordingTitle: metadata.title, adapterId: row.adapterId, state: row.state, attempt: row.attempt, failureClass: row.failureClass as UploadFailureClass | null, nextAttemptAt: row.nextAttemptAt, lastError: row.lastError, lastErrorAt: row.lastErrorAt, remoteLectureId: row.remoteLectureId, progressPct: total === 0 ? (row.state === 'done' ? 100 : 0) : Math.floor(sent * 100 / total), blockedBy: row.blockedBy as 'merge' | null, enqueuedAt: row.enqueuedAt, startedAt: row.startedAt, completedAt: row.completedAt, requeuedAt: row.requeuedAt };
  }
  publishJob(jobId: string): void { const row = this.deps.db.select().from(uploadJobs).where(eq(uploadJobs.id, jobId)).get(); if (row) { const job = this.toJob(row); this.deps.bus.publish('upload.job', { jobId: job.id, recordingId: job.recordingId, state: job.state, attempt: job.attempt, failureClass: job.failureClass, nextAttemptAt: job.nextAttemptAt, progressPct: job.progressPct, lastError: job.lastError, blockedBy: job.blockedBy }); } }
  publishPart(partId: string): void { const row = this.deps.db.select().from(uploadFileParts).where(eq(uploadFileParts.id, partId)).get(); if (row) this.deps.bus.publish('upload.part', { partId: row.id, jobId: row.uploadJobId, streamKey: row.streamKey, state: row.state, bytesSent: Number(row.bytesSent), bytesTotal: Number(row.bytesTotal) }); }
  #admin(actor: AuthContext): void { if (actor.role !== 'admin') throw new ProblemError(403, 'not-authorized', 'Administrator role required'); }
}
