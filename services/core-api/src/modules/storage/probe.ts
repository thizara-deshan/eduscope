import type { RetentionPolicy, StoragePressure, StorageStatusPayload } from '@eduscope/shared';
import { eq } from 'drizzle-orm';
import { deviceHealth, lectureSessions, retentionPolicy } from '../../db/schema.js';
import type { DrizzleDb } from '../../db/client.js';
import type { Cancel, Clock } from '../../lib/clock.js';
import type { DomainBus } from '../../lib/domain-bus.js';
import type { LifecycleComponent, LifecycleStopReason } from '../../lifecycle.js';

export const RECORDING_PROBE_INTERVAL_MS = 10_000;
export const IDLE_PROBE_INTERVAL_MS = 60_000;
export const STORAGE_HYSTERESIS_PCT = 5;
export const RECORDING_STOP_FLOOR_BYTES = 4 * 1024 ** 3;

export interface StorageSpace {
  totalBytes: number;
  freeBytes: number;
}

export type StorageStatfs = () => Promise<StorageSpace>;

export interface StorageSnapshot extends StorageStatusPayload {
  observedAt: string;
  known: boolean;
}

export interface StorageProbeDeps {
  db: DrizzleDb;
  clock: Clock;
  bus: DomainBus;
  statfs: StorageStatfs;
  stopRecording(): Promise<void>;
  persistHealth?: boolean;
  logger?: { warn(message: string, meta?: Record<string, unknown>): void };
}

function toPolicy(row: typeof retentionPolicy.$inferSelect): RetentionPolicy {
  return {
    maxAgeDays: row.maxAgeDays,
    warningThresholdPct: row.warningThresholdPct,
    criticalThresholdPct: row.criticalThresholdPct,
    earlyDeleteOrder: row.earlyDeleteOrder,
    neverDeleteUnuploaded: row.neverDeleteUnuploaded,
    refuseStartWhenCritical: row.refuseStartWhenCritical,
  };
}

function pressureFor(usedPct: number, previous: StoragePressure, policy: RetentionPolicy): StoragePressure {
  if (usedPct >= policy.criticalThresholdPct) return 'critical';
  if (previous === 'critical' && usedPct >= policy.criticalThresholdPct - STORAGE_HYSTERESIS_PCT) return 'critical';
  if (usedPct >= policy.warningThresholdPct) return 'warning';
  if (previous === 'warning' && usedPct >= policy.warningThresholdPct - STORAGE_HYSTERESIS_PCT) return 'warning';
  return 'ok';
}

export class StorageProbe implements LifecycleComponent {
  readonly name = 'storage-probe';
  #statfs: StorageStatfs;
  #timer: Cancel | null = null;
  #lastProbeAt = Number.NEGATIVE_INFINITY;
  #floorStopRequested = false;
  #snapshot: StorageSnapshot;

  constructor(readonly deps: StorageProbeDeps) {
    this.#statfs = deps.statfs;
    this.#snapshot = {
      pressure: 'critical',
      totalBytes: 0,
      freeBytes: 0,
      policy: {
        maxAgeDays: 14,
        warningThresholdPct: 80,
        criticalThresholdPct: 95,
        earlyDeleteOrder: 'uploaded-oldest-first',
        neverDeleteUnuploaded: true,
        refuseStartWhenCritical: true,
      },
      observedAt: deps.clock.now().toISOString(),
      known: false,
    };
  }

  async start(): Promise<void> {
    const row = this.deps.db.select().from(retentionPolicy).where(eq(retentionPolicy.id, 'retention-policy')).get();
    if (!row) throw new Error('retention policy seed is missing');
    this.#snapshot = { ...this.#snapshot, policy: toPolicy(row) };
    await this.probe();
    this.#timer = this.deps.clock.every(RECORDING_PROBE_INTERVAL_MS, () => { void this.#tick(); });
  }

  async stop(_reason: LifecycleStopReason): Promise<void> {
    this.#timer?.cancel();
    this.#timer = null;
  }

  snapshot(): StorageSnapshot {
    return this.#snapshot;
  }

  setStatfs(statfs: StorageStatfs): void {
    this.#statfs = statfs;
  }

  async probe(): Promise<StorageSnapshot> {
    const previous = this.#snapshot.pressure;
    const observedAt = this.deps.clock.now().toISOString();
    let known = true;
    let totalBytes = 0;
    let freeBytes = 0;
    let pressure: StoragePressure = 'critical';

    try {
      const space = await this.#statfs();
      if (!Number.isFinite(space.totalBytes) || !Number.isFinite(space.freeBytes) || space.totalBytes <= 0 || space.freeBytes < 0) {
        throw new Error('statfs returned invalid capacity values');
      }
      totalBytes = Math.trunc(space.totalBytes);
      freeBytes = Math.min(Math.trunc(space.freeBytes), totalBytes);
      pressure = pressureFor(((totalBytes - freeBytes) / totalBytes) * 100, previous, this.#snapshot.policy);
    } catch (error) {
      known = false;
      this.deps.logger?.warn('storage probe failed closed', { error: error instanceof Error ? error.message : String(error) });
    }

    this.#lastProbeAt = this.deps.clock.now().getTime();
    this.#snapshot = { pressure, totalBytes, freeBytes, policy: this.#snapshot.policy, observedAt, known };
    if (this.deps.persistHealth !== false) this.#persist();
    this.deps.bus.publish('storage.status', this.#publicPayload());

    if (known && freeBytes < RECORDING_STOP_FLOOR_BYTES && !this.#floorStopRequested) {
      this.#floorStopRequested = true;
      await this.deps.stopRecording();
    } else if (!known || freeBytes >= RECORDING_STOP_FLOOR_BYTES) {
      this.#floorStopRequested = false;
    }
    return this.#snapshot;
  }

  async #tick(): Promise<void> {
    const recording = this.deps.db.select({ id: lectureSessions.id }).from(lectureSessions).where(eq(lectureSessions.state, 'recording')).get();
    const interval = recording ? RECORDING_PROBE_INTERVAL_MS : IDLE_PROBE_INTERVAL_MS;
    if (this.deps.clock.now().getTime() - this.#lastProbeAt >= interval) await this.probe();
  }

  #publicPayload(): StorageStatusPayload {
    const { pressure, totalBytes, freeBytes, policy } = this.#snapshot;
    return { pressure, totalBytes, freeBytes, policy };
  }

  #persist(): void {
    const existing = this.deps.db.select().from(deviceHealth).where(eq(deviceHealth.id, 'device-health')).get();
    const values = {
      id: 'device-health',
      deviceId: existing?.deviceId ?? 'local-device',
      observedAt: this.#snapshot.observedAt,
      storageTotalBytes: this.#snapshot.totalBytes,
      storageFreeBytes: this.#snapshot.freeBytes,
      storagePressure: this.#snapshot.pressure,
      diskHealth: existing?.diskHealth ?? ('unknown' as const),
      captureCardState: existing?.captureCardState ?? ('absent' as const),
      publisherStates: existing?.publisherStates ?? {},
      ntpSynced: existing?.ntpSynced ?? false,
      clockOffsetMs: existing?.clockOffsetMs ?? null,
      lastBootAt: existing?.lastBootAt ?? this.#snapshot.observedAt,
      cpuLoad1m: existing?.cpuLoad1m ?? null,
      tempC: existing?.tempC ?? null,
    };
    this.deps.db.insert(deviceHealth).values(values).onConflictDoUpdate({ target: deviceHealth.id, set: values }).run();
  }
}
