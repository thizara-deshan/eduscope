import { z } from 'zod';
import { Instant, Ulid } from './primitives';
import {
  CaptureCardState,
  SmartStatus,
  SourceRoleId,
  StoragePressure,
  StorageVolumeRole,
  StorageVolumeState,
} from './enums';

/** Context A — device health & storage (domain model §4.2–4.3, §7.3). */

/** Projection of pipeline-manager truth; stale ⇒ reported unknown, never healthy (INV-DH-2). */
export const PublisherState = z.object({
  status: z.enum(['running', 'starting', 'exited', 'failed', 'unknown']),
  lastErrorCode: z.string().nullable(),
  since: Instant,
});
export type PublisherState = z.infer<typeof PublisherState>;

/** Snapshot, not a history (INV-DH-1) — trends come from LogEntry. */
export const DeviceHealth = z.object({
  deviceId: Ulid,
  observedAt: Instant,
  storageTotalBytes: z.number().int().nonnegative(),
  storageFreeBytes: z.number().int().nonnegative(),
  storagePressure: StoragePressure, // [D-15]
  diskHealth: SmartStatus, // AD-4
  captureCardState: CaptureCardState, // PF-13, machine 5c
  publisherStates: z.record(SourceRoleId, PublisherState),
  ntpSynced: z.boolean(), // AD-10, PF-19 [D-17]
  clockOffsetMs: z.number().int().nullable(),
  lastBootAt: Instant,
  cpuLoad1m: z.number().nullable(),
  tempC: z.number().nullable(),
});
export type DeviceHealth = z.infer<typeof DeviceHealth>;

export const StorageVolume = z.object({
  id: Ulid,
  uuid: z.string().max(64),
  devicePath: z.string().max(128), // informational; never the join key (B-38)
  mountPath: z.string().max(256),
  label: z.string().max(64).nullable(),
  filesystem: z.string().max(32),
  capacityBytes: z.number().int().nonnegative(),
  freeBytes: z.number().int().nonnegative(),
  smartStatus: SmartStatus,
  role: StorageVolumeRole,
  state: StorageVolumeState,
  registeredAt: Instant,
});
export type StorageVolume = z.infer<typeof StorageVolume>;

/** Read view of RetentionPolicy — warning text is generated from these values (INV-RP-1). [D-15] */
export const RetentionPolicy = z.object({
  maxAgeDays: z.number().int().positive(), // 14 (A-20)
  warningThresholdPct: z.number().int().min(1).max(100),
  criticalThresholdPct: z.number().int().min(1).max(100),
  earlyDeleteOrder: z.literal('uploaded-oldest-first'),
  neverDeleteUnuploaded: z.boolean(), // explicit reversal of B-20
  refuseStartWhenCritical: z.boolean(),
});
export type RetentionPolicy = z.infer<typeof RetentionPolicy>;

/** AD-4 Local Storage page payload. */
export const StorageOverview = z.object({
  pressure: StoragePressure,
  totalBytes: z.number().int().nonnegative(),
  freeBytes: z.number().int().nonnegative(),
  volumes: z.array(StorageVolume),
  policy: RetentionPolicy,
});
export type StorageOverview = z.infer<typeof StorageOverview>;

/** AD-4 disk swap: register (+mount) a new recordings volume — no restart, no nginx surgery (INV-SV-2, B-51). */
export const RegisterVolumeRequest = z.object({
  uuid: z.string().min(1).max(64),
  label: z.string().max(64).optional(),
});
export type RegisterVolumeRequest = z.infer<typeof RegisterVolumeRequest>;

/**
 * AD-4 danger zone: format + register is one guarded operation (B-52).
 * `confirmText` must equal the volume's label (or uuid when unlabelled) — the
 * confirm names the device (J-5 failure path).
 */
export const FormatVolumeRequest = z.object({
  confirmText: z.string().min(1),
});
export type FormatVolumeRequest = z.infer<typeof FormatVolumeRequest>;
