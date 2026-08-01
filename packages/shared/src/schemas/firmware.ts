import { z } from 'zod';
import { Instant, Ulid } from './primitives';
import { FirmwareState } from './enums';

/**
 * Context A — FirmwareUpdate (domain model §4.13, AD-5).
 * Signed artifacts only (INV-FU-1); a failed update leaves the device on
 * rollbackVersion (INV-FU-2).
 */
export const FirmwareUpdate = z.object({
  id: Ulid,
  currentVersion: z.string().max(32),
  availableVersion: z.string().max(32).nullable(),
  state: FirmwareState,
  signatureVerified: z.boolean(),
  rollbackVersion: z.string().max(32).nullable(),
  startedAt: Instant.nullable(),
  finishedAt: Instant.nullable(),
  lastError: z.string().nullable(),
});
export type FirmwareUpdate = z.infer<typeof FirmwareUpdate>;
