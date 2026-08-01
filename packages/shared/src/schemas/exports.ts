import { z } from 'zod';
import { Instant, Ulid } from './primitives';
import { ExportJobState } from './enums';

/**
 * Context C — copy-to-USB (domain model §6.5, LP-10/LP-11).
 * Progress is reported by the transfer itself, never free-space arithmetic
 * (INV-EX-1, B-32). USB presence is transient — WS events + this snapshot,
 * never persisted (domain model §10).
 */

/** A candidate export target. System disk and the recordings volume are never listed (INV-EX-2). */
export const UsbVolume = z.object({
  devicePath: z.string().max(128),
  mountPath: z.string().max(256),
  label: z.string().max(64).nullable(),
  capacityBytes: z.number().int().nonnegative(),
  freeBytes: z.number().int().nonnegative(),
});
export type UsbVolume = z.infer<typeof UsbVolume>;

export const ExportJob = z.object({
  id: Ulid,
  requestedAt: Instant,
  targetVolume: UsbVolume, // snapshot of the chosen drive (B-38: user picks, never "first")
  recordingIds: z.array(Ulid), // multi-select (LP-10)
  bytesTotal: z.number().int().nonnegative(),
  bytesCopied: z.number().int().nonnegative(),
  state: ExportJobState,
  error: z.string().nullable(),
});
export type ExportJob = z.infer<typeof ExportJob>;

export const ExportCreateRequest = z.object({
  recordingIds: z.array(Ulid).min(1),
  /** Identifies the chosen UsbVolume from GET /exports/targets. */
  targetDevicePath: z.string().min(1).max(128),
});
export type ExportCreateRequest = z.infer<typeof ExportCreateRequest>;
