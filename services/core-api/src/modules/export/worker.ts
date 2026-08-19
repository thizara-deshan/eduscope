import { createReadStream } from 'node:fs';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { Readable } from 'node:stream';
import type { CommandAccepted, ExportJob, ExportJobPayload, UsbVolume } from '@eduscope/shared';
import { TIMERS } from '@eduscope/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { ProblemError } from '../../contracts/problem.js';
import type { DrizzleDb } from '../../db/client.js';
import { exportJobs, recordingFiles, recordings } from '../../db/schema.js';
import type { Clock } from '../../lib/clock.js';
import type { DomainBus } from '../../lib/domain-bus.js';
import type { IdGenerator } from '../../lib/ids.js';
import type { LifecycleComponent, LifecycleStopReason } from '../../lifecycle.js';
import type { AuthContext } from '../auth/service.js';
import { publicUsbVolumes, type BlockDeviceMonitorLike } from './udev.js';
import type { ScopedSubscriptionRegistry } from './subscriptions.js';

export type ExportSourceStream = (path: string, signal: AbortSignal) => Readable;

interface ExportFile { id: string; recordingId: string; path: string; sizeBytes: number; }
interface ActiveJob { id: string; targetDevicePath: string; abort: AbortController; terminal: 'failed' | 'cancelled'; error: string; partial: string | null; promise: Promise<void>; }

export interface ExportWorkerDeps {
  db: DrizzleDb;
  clock: Clock;
  ids: IdGenerator;
  bus: DomainBus;
  monitor: BlockDeviceMonitorLike;
  subscriptions: ScopedSubscriptionRegistry;
  recordingsRoot: string;
  sourceStream?: ExportSourceStream;
  logger?: { warn(message: string, meta?: Record<string, unknown>): void };
}

function toJob(row: typeof exportJobs.$inferSelect): ExportJob {
  return {
    id: row.id,
    requestedAt: row.requestedAt,
    targetVolume: { ...row.targetVolume, capacityBytes: Number(row.targetVolume.capacityBytes), freeBytes: row.targetVolume.freeBytes ?? 0 },
    recordingIds: row.recordingIds,
    bytesTotal: row.bytesTotal,
    bytesCopied: row.bytesCopied,
    state: row.state,
    error: row.error,
  };
}

export class ExportExecutor implements LifecycleComponent {
  readonly name = 'usb-export-executor';
  readonly #deps: ExportWorkerDeps;
  readonly #sourceStream: ExportSourceStream;
  readonly #queue: string[] = [];
  #active: ActiveJob | null = null;
  #accepting = false;
  #unsubscribe: (() => void) | null = null;

  constructor(deps: ExportWorkerDeps) {
    this.#deps = deps;
    this.#sourceStream = deps.sourceStream ?? ((path, signal) => createReadStream(path, { signal }));
  }

  async start(): Promise<void> {
    this.#accepting = true;
    this.#unsubscribe = this.#deps.monitor.subscribe((volumes) => {
      this.#deps.bus.publish('usb.volumes', { volumes: publicUsbVolumes(volumes) });
      const active = this.#active;
      if (active && !publicUsbVolumes(volumes).some((volume) => volume.devicePath === active.targetDevicePath)) {
        active.terminal = 'failed';
        active.error = 'USB target removed during export';
        active.abort.abort(new Error(active.error));
      }
    });
  }

  async stop(_reason: LifecycleStopReason): Promise<void> {
    this.#accepting = false;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#queue.length = 0;
    if (this.#active) {
      this.#active.terminal = 'failed';
      this.#active.error = 'Export interrupted by shutdown';
      this.#active.abort.abort(new Error(this.#active.error));
      await this.#active.promise;
    }
  }

  async listTargets(): Promise<UsbVolume[]> {
    const snapshot = await this.#deps.monitor.refresh();
    return publicUsbVolumes(snapshot);
  }

  async create(input: { recordingIds: string[]; targetDevicePath: string }, actor: AuthContext): Promise<ExportJob> {
    if (!this.#accepting) throw new ProblemError(409, 'conflict', 'Export executor is stopping');
    const target = (await this.listTargets()).find((volume) => volume.devicePath === input.targetDevicePath);
    if (!target) throw new ProblemError(422, 'export.invalid-target', 'Selected USB target is unavailable');
    const distinctIds = [...new Set(input.recordingIds)];
    const owned = this.#deps.db.select({ id: recordings.id, ownerUserId: recordings.ownerUserId }).from(recordings).where(inArray(recordings.id, distinctIds)).all();
    if (owned.length !== distinctIds.length || (actor.role !== 'admin' && owned.some((recording) => recording.ownerUserId !== actor.userId))) {
      throw new ProblemError(404, 'not-found', 'Recording not found');
    }
    const files = this.#deps.db.select({ id: recordingFiles.id, recordingId: recordingFiles.recordingId, path: recordingFiles.path, sizeBytes: recordingFiles.sizeBytes })
      .from(recordingFiles)
      .where(and(inArray(recordingFiles.recordingId, distinctIds), eq(recordingFiles.state, 'finalized')))
      .orderBy(recordingFiles.recordingId, recordingFiles.id)
      .all()
      .filter((file): file is ExportFile => file.sizeBytes !== null);
    const bytesTotal = files.reduce((total, file) => total + file.sizeBytes, 0);
    if (files.length === 0) throw new ProblemError(422, 'validation.invalid', 'No finalized recording files are available');
    if (target.freeBytes < bytesTotal) throw new ProblemError(422, 'export.insufficient-space', 'Selected USB target has insufficient free space');
    const now = this.#deps.clock.now();
    const id = this.#deps.ids.next(now);
    this.#deps.db.insert(exportJobs).values({ id, requestedBy: actor.userId, requestedAt: now.toISOString(), authSessionId: actor.authSessionId, targetVolume: target, recordingIds: distinctIds, fileIds: files.map((file) => file.id), bytesTotal, bytesCopied: 0, state: 'queued', error: null }).run();
    this.#deps.subscriptions.refresh(actor.authSessionId, 'export.job', id);
    this.#publish(id);
    this.#queue.push(id);
    queueMicrotask(() => { void this.#pump(); });
    return this.get(id, actor, false);
  }

  get(id: string, actor: AuthContext, subscribe = true): ExportJob {
    const row = this.#deps.db.select().from(exportJobs).where(eq(exportJobs.id, id)).get();
    if (!row || (actor.role !== 'admin' && row.requestedBy !== actor.userId)) throw new ProblemError(404, 'not-found', 'Export not found');
    if (subscribe) this.#deps.subscriptions.refresh(actor.authSessionId, 'export.job', id);
    return toJob(row);
  }

  async cancel(id: string, actor: AuthContext): Promise<CommandAccepted> {
    const row = this.#deps.db.select().from(exportJobs).where(eq(exportJobs.id, id)).get();
    if (!row || (actor.role !== 'admin' && row.requestedBy !== actor.userId)) throw new ProblemError(404, 'not-found', 'Export not found');
    if (row.state !== 'queued' && row.state !== 'copying') throw new ProblemError(409, 'conflict', 'Export is already terminal');
    const active = this.#active?.id === id ? this.#active : null;
    if (active) {
      active.terminal = 'cancelled';
      active.error = 'Export cancelled';
      active.abort.abort(new Error(active.error));
      await active.promise;
    } else {
      const index = this.#queue.indexOf(id);
      if (index >= 0) this.#queue.splice(index, 1);
      this.#setState(id, 'cancelled', null);
    }
    const now = this.#deps.clock.now();
    return { commandId: this.#deps.ids.next(now), acceptedAt: now.toISOString(), resolveBySec: TIMERS['T-CMD-RESOLVE'] / 1000 };
  }

  async #pump(): Promise<void> {
    if (this.#active || !this.#accepting) return;
    const id = this.#queue.shift();
    if (!id) return;
    const abort = new AbortController();
    const active: ActiveJob = { id, targetDevicePath: '', abort, terminal: 'failed', error: 'Export failed', partial: null, promise: Promise.resolve() };
    const row = this.#deps.db.select().from(exportJobs).where(eq(exportJobs.id, id)).get();
    if (!row || row.state !== 'queued') return;
    active.targetDevicePath = row.targetVolume.devicePath;
    active.promise = this.#run(active, row).finally(() => {
      if (this.#active === active) this.#active = null;
      queueMicrotask(() => { void this.#pump(); });
    });
    this.#active = active;
    await active.promise;
  }

  async #run(active: ActiveJob, job: typeof exportJobs.$inferSelect): Promise<void> {
    this.#setState(job.id, 'copying', null);
    let copied = 0;
    let lastPublished = 0;
    const threshold = Math.max(1, Math.ceil(job.bytesTotal * 0.05));
    try {
      const files = this.#deps.db.select({ id: recordingFiles.id, recordingId: recordingFiles.recordingId, path: recordingFiles.path }).from(recordingFiles).where(inArray(recordingFiles.id, job.fileIds)).orderBy(recordingFiles.recordingId, recordingFiles.id).all();
      for (const file of files) {
        const directory = join(job.targetVolume.mountPath, 'EduScope', file.recordingId);
        await mkdir(directory, { recursive: true });
        const finalPath = join(directory, `${file.id}-${basename(file.path)}`);
        const partialPath = `${finalPath}.partial`;
        active.partial = partialPath;
        const handle = await open(partialPath, 'w');
        try {
          for await (const value of this.#sourceStream(file.path, active.abort.signal)) {
            if (active.abort.signal.aborted) throw active.abort.signal.reason;
            const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
            let offset = 0;
            while (offset < chunk.length) {
              const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset);
              if (bytesWritten === 0) throw new Error('USB copy made no forward progress');
              offset += bytesWritten;
              copied += bytesWritten;
              if (copied - lastPublished >= threshold) {
                this.#setProgress(job.id, copied);
                lastPublished = copied;
              }
            }
          }
          await handle.sync();
        } finally {
          await handle.close();
        }
        if (active.abort.signal.aborted) throw active.abort.signal.reason;
        await rename(partialPath, finalPath);
        active.partial = null;
      }
      this.#deps.db.update(exportJobs).set({ bytesCopied: job.bytesTotal, state: 'completed', error: null }).where(eq(exportJobs.id, job.id)).run();
      this.#publish(job.id);
    } catch (error) {
      if (active.partial) await rm(active.partial, { force: true });
      active.partial = null;
      const message = active.abort.signal.aborted ? active.error : error instanceof Error ? error.message : String(error);
      this.#setState(job.id, active.abort.signal.aborted ? active.terminal : 'failed', active.terminal === 'cancelled' ? null : message);
    }
  }

  #setProgress(id: string, bytesCopied: number): void {
    this.#deps.db.update(exportJobs).set({ bytesCopied }).where(eq(exportJobs.id, id)).run();
    this.#publish(id);
  }

  #setState(id: string, state: 'copying' | 'failed' | 'cancelled', error: string | null): void {
    this.#deps.db.update(exportJobs).set({ state, error }).where(eq(exportJobs.id, id)).run();
    this.#publish(id);
  }

  #publish(id: string): void {
    const row = this.#deps.db.select().from(exportJobs).where(eq(exportJobs.id, id)).get();
    if (!row) return;
    const payload: ExportJobPayload = { jobId: row.id, state: row.state, bytesCopied: row.bytesCopied, bytesTotal: row.bytesTotal, error: row.error };
    this.#deps.bus.publish('export.job', payload);
  }
}
