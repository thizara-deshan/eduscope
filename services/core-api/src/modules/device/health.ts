import type { CaptureCardState, DeviceHealth, DeviceHealthPayload, SmartStatus, StoragePressure } from '@eduscope/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { DrizzleDb } from '../../db/client.js';
import { deviceHealth } from '../../db/schema.js';
import type { Cancel, Clock } from '../../lib/clock.js';
import type { DomainBus, Unsubscribe } from '../../lib/domain-bus.js';
import type { HelperClient } from '../../lib/helper-client.js';
import type { IdGenerator } from '../../lib/ids.js';
import type { LifecycleComponent, LifecycleStopReason } from '../../lifecycle.js';
import type { PmPublisherId, PmPublisherState, PmStatus } from '../recording/pm/types.js';
import { PM_PUBLISHER_TO_ROLE } from '../sources/status.js';

/** device.health emits on change + this cadence (§2.9, mirrors storage.status's 60s). */
export const HEALTH_REFRESH_INTERVAL_MS = 60_000;

type PublisherHealthStatus = 'running' | 'starting' | 'exited' | 'failed' | 'unknown';
type PublisherStatesMap = Record<string, { status: PublisherHealthStatus; lastErrorCode: string | null; since: string }>;

/** No 1:1 enum match to pipeline-manager's publisher vocabulary — `degraded` still counts as `running` here, since DeviceHealth.publisherStates is a coarse hardware-alert projection, not the live per-role health B-09 already owns. */
function mapPublisherStatus(state: PmPublisherState): PublisherHealthStatus {
  switch (state) {
    case 'online':
    case 'degraded':
      return 'running';
    case 'offline':
      return 'exited';
    default:
      return 'unknown';
  }
}

const zSmartDetail = z.object({ health: z.enum(['good', 'warning', 'failing', 'unknown']) });

export interface NtpReading {
  synced: boolean;
  offsetMs: number | null;
}

export type NtpReader = () => Promise<NtpReading>;

export interface HealthAggregatorLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

export interface HealthAggregatorDeps {
  db: DrizzleDb;
  clock: Clock;
  ids: IdGenerator;
  bus: DomainBus;
  helper: HelperClient;
  ntp: NtpReader;
  deviceId: string;
  /** The current recordings volume's device node, or `null` when none is mounted (skips the SMART probe — diskHealth reads `unknown`). */
  smartDevNode(): string | null;
  logger?: HealthAggregatorLogger;
}

/**
 * Machine 5c / design/core-api.md §8 "Device health": aggregates the storage
 * probe's totals (via `storage.status`), pipeline-manager's capture-card and
 * publisher telemetry (via `pm.status.resynced`), and the SMART/NTP
 * boundaries this task owns, into the one persisted `device_health` singleton
 * (INV-DH-1: snapshot, not history). Stale pm telemetry is never carried
 * forward as healthy (INV-DH-2) — this class only ever reflects the last
 * `pm.status.resynced` it received, never inference between them.
 */
export class HealthAggregator implements LifecycleComponent {
  readonly name = 'health-aggregator';

  readonly #deps: HealthAggregatorDeps;
  #timer: Cancel | null = null;
  #unsubscribePm: Unsubscribe | null = null;
  #unsubscribeStorage: Unsubscribe | null = null;

  #captureCardState: CaptureCardState = 'absent';
  #publisherStates: PublisherStatesMap = {};
  #ntpSynced = false;
  #clockOffsetMs: number | null = null;
  #diskHealth: SmartStatus = 'unknown';
  #storageTotalBytes = 0;
  #storageFreeBytes = 0;
  /** `'ok'` until the first real reading arrives (via the persisted row or `storage.status`) — B-19 owns the true value and always probes before this class's `start()` runs in `app.ts`'s registration order; defaulting to `'critical'` here would wrongly trip `assertStorageOk`'s G-STORAGE-OK guard in any harness that starts the app without a live storage probe. */
  #storagePressure: StoragePressure = 'ok';
  #lastBootAt: string;

  constructor(deps: HealthAggregatorDeps) {
    this.#deps = deps;
    this.#lastBootAt = deps.clock.now().toISOString();
  }

  async start(): Promise<void> {
    this.#lastBootAt = this.#deps.clock.now().toISOString();

    const existing = this.#deps.db.select().from(deviceHealth).where(eq(deviceHealth.id, 'device-health')).get();
    if (existing) {
      this.#storageTotalBytes = Number(existing.storageTotalBytes);
      this.#storageFreeBytes = Number(existing.storageFreeBytes);
      this.#storagePressure = existing.storagePressure;
    }

    await this.#probeAuxiliary();
    this.#persist();
    this.#deps.bus.publish('device.health', this.#toPayload());

    this.#timer = this.#deps.clock.every(HEALTH_REFRESH_INTERVAL_MS, () => {
      void this.#tick();
    });
    this.#unsubscribePm = this.#deps.bus.subscribe('pm.status.resynced', (status) => this.#onPmStatus(status));
    this.#unsubscribeStorage = this.#deps.bus.subscribe('storage.status', (status) => {
      this.#storageTotalBytes = status.totalBytes;
      this.#storageFreeBytes = status.freeBytes;
      this.#storagePressure = status.pressure;
    });
  }

  async stop(_reason: LifecycleStopReason): Promise<void> {
    this.#timer?.cancel();
    this.#timer = null;
    this.#unsubscribePm?.();
    this.#unsubscribePm = null;
    this.#unsubscribeStorage?.();
    this.#unsubscribeStorage = null;
  }

  snapshot(): DeviceHealth {
    return {
      deviceId: this.#deps.deviceId,
      observedAt: this.#deps.clock.now().toISOString(),
      storageTotalBytes: this.#storageTotalBytes,
      storageFreeBytes: this.#storageFreeBytes,
      storagePressure: this.#storagePressure,
      diskHealth: this.#diskHealth,
      captureCardState: this.#captureCardState,
      publisherStates: this.#publisherStates,
      ntpSynced: this.#ntpSynced,
      clockOffsetMs: this.#clockOffsetMs,
      lastBootAt: this.#lastBootAt,
      cpuLoad1m: null,
      tempC: null,
    };
  }

  async #tick(): Promise<void> {
    await this.#probeAuxiliary();
    this.#persist();
    this.#deps.bus.publish('device.health', this.#toPayload());
  }

  #onPmStatus(status: PmStatus): void {
    const captureChanged = this.#captureCardState !== status.device.captureCardState;
    this.#captureCardState = status.device.captureCardState;

    const nowIso = this.#deps.clock.now().toISOString();
    let publisherChanged = false;
    const next: PublisherStatesMap = {};
    for (const [publisherId, roleId] of Object.entries(PM_PUBLISHER_TO_ROLE) as [PmPublisherId, string][]) {
      const publisher = status.publishers[publisherId];
      const mapped = publisher ? mapPublisherStatus(publisher.state) : 'unknown';
      const lastErrorCode = publisher?.lastError ?? null;
      const prior = this.#publisherStates[roleId];
      if (prior && prior.status === mapped && prior.lastErrorCode === lastErrorCode) {
        next[roleId] = prior;
      } else {
        publisherChanged = true;
        next[roleId] = { status: mapped, lastErrorCode, since: nowIso };
      }
    }
    this.#publisherStates = next;

    if (captureChanged || publisherChanged) {
      this.#persist();
      this.#deps.bus.publish('device.health', this.#toPayload());
    }
  }

  async #probeAuxiliary(): Promise<void> {
    try {
      const reading = await this.#deps.ntp();
      this.#ntpSynced = reading.synced;
      this.#clockOffsetMs = reading.offsetMs;
    } catch (error) {
      this.#ntpSynced = false;
      this.#clockOffsetMs = null;
      this.#deps.logger?.warn('health: ntp read failed', { error: error instanceof Error ? error.message : String(error) });
    }

    const devNode = this.#deps.smartDevNode();
    if (!devNode) {
      this.#diskHealth = 'unknown';
      return;
    }
    try {
      const result = await this.#deps.helper.request('smart.read', { devNode }, this.#deps.ids.next(this.#deps.clock.now()));
      const parsed = zSmartDetail.safeParse(JSON.parse(result.detail));
      this.#diskHealth = parsed.success ? parsed.data.health : 'unknown';
    } catch (error) {
      this.#diskHealth = 'unknown';
      this.#deps.logger?.warn('health: smart.read failed', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  #persist(): void {
    const values = {
      id: 'device-health' as const,
      deviceId: this.#deps.deviceId,
      observedAt: this.#deps.clock.now().toISOString(),
      storageTotalBytes: this.#storageTotalBytes,
      storageFreeBytes: this.#storageFreeBytes,
      storagePressure: this.#storagePressure,
      diskHealth: this.#diskHealth,
      captureCardState: this.#captureCardState,
      publisherStates: this.#publisherStates,
      ntpSynced: this.#ntpSynced,
      clockOffsetMs: this.#clockOffsetMs,
      lastBootAt: this.#lastBootAt,
      cpuLoad1m: null,
      tempC: null,
    };
    this.#deps.db.insert(deviceHealth).values(values).onConflictDoUpdate({ target: deviceHealth.id, set: values }).run();
  }

  #toPayload(): DeviceHealthPayload {
    return {
      captureCardState: this.#captureCardState,
      publisherStates: this.#publisherStates,
      ntpSynced: this.#ntpSynced,
      clockOffsetMs: this.#clockOffsetMs,
      diskHealth: this.#diskHealth,
      lastBootAt: this.#lastBootAt,
    };
  }
}
