import { and, asc, eq, lte } from 'drizzle-orm';
import { lectureSessions, recordings, uploadJobs } from '../../db/schema.js';
import type { Cancel, Clock } from '../../lib/clock.js';
import type { DomainBus, Unsubscribe } from '../../lib/domain-bus.js';
import type { LifecycleComponent, LifecycleStopReason } from '../../lifecycle.js';
import { deleteRecordingInternal, type LibraryDeleteDeps } from '../library/delete.js';
import type { StorageProbe } from './probe.js';

export const RETENTION_SWEEP_INTERVAL_MS = 15 * 60_000;
export type RetentionSweepTrigger = 'scheduled' | 'upload' | 'pressure';

export interface RetentionSweepDeps extends LibraryDeleteDeps {
  clock: Clock;
  bus: DomainBus;
  probe: StorageProbe;
}

export class RetentionSweep implements LifecycleComponent {
  readonly name = 'retention-sweep';
  #timer: Cancel | null = null;
  #unsubscribes: Unsubscribe[] = [];
  #running = false;

  constructor(readonly deps: RetentionSweepDeps) {}

  async start(): Promise<void> {
    this.#timer = this.deps.clock.every(RETENTION_SWEEP_INTERVAL_MS, () => { void this.run('scheduled'); });
    this.#unsubscribes.push(
      this.deps.bus.subscribe('upload.job', (event) => { if (event.state === 'done') void this.run('upload'); }),
      this.deps.bus.subscribe('storage.status', (event) => { if (event.pressure !== 'ok') void this.run('pressure'); }),
    );
  }

  async stop(_reason: LifecycleStopReason): Promise<void> {
    this.#timer?.cancel();
    this.#timer = null;
    for (const unsubscribe of this.#unsubscribes.splice(0)) unsubscribe();
  }

  async run(trigger: RetentionSweepTrigger): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    try {
      const deletedExpired = await this.#deleteExpiredUploaded();
      if (deletedExpired) await this.deps.probe.probe();
      if (trigger === 'pressure' || this.deps.probe.snapshot().pressure !== 'ok') await this.#relievePressure();
    } finally {
      this.#running = false;
    }
  }

  async #deleteExpiredUploaded(): Promise<boolean> {
    const rows = this.deps.db
      .select({ recordingId: recordings.id })
      .from(recordings)
      .innerJoin(uploadJobs, eq(uploadJobs.recordingId, recordings.id))
      .where(and(eq(recordings.state, 'ready'), eq(uploadJobs.state, 'done'), lte(recordings.retentionDeleteAfter, this.deps.clock.now().toISOString())))
      .orderBy(asc(recordings.retentionDeleteAfter))
      .all();
    for (const row of rows) deleteRecordingInternal(this.deps, row.recordingId, { kind: 'system' }, 'retention');
    return rows.length > 0;
  }

  async #relievePressure(): Promise<void> {
    if (this.deps.probe.snapshot().pressure === 'ok') return;
    const rows = this.deps.db
      .select({ recordingId: recordings.id })
      .from(recordings)
      .innerJoin(lectureSessions, eq(lectureSessions.id, recordings.sessionId))
      .innerJoin(uploadJobs, eq(uploadJobs.recordingId, recordings.id))
      .where(and(eq(recordings.state, 'ready'), eq(uploadJobs.state, 'done')))
      .orderBy(asc(lectureSessions.startedAt))
      .all();
    for (const row of rows) {
      deleteRecordingInternal(this.deps, row.recordingId, { kind: 'system' }, 'disk-pressure');
      await this.deps.probe.probe();
      if (this.deps.probe.snapshot().pressure === 'ok') break;
    }
  }
}
