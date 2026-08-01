import { z } from 'zod';
import { Instant, Ulid } from './primitives';

/**
 * Context A — DeviceProvisioning read view (domain model §4.1).
 * core-api never writes this entity (INV-DP-1); the Admin AD-10 page renders it
 * read-only [D-20]. Secret-bearing fields (uploadTargetProfile credentials) are
 * never exposed.
 */

export const FeatureFlags = z.object({
  recordingEnabled: z.boolean(),
  aiQuizEnabled: z.boolean(), // INT-10; flipping off never affects recording (INV-DP-4)
  streamingEnabled: z.boolean(),
});
export type FeatureFlags = z.infer<typeof FeatureFlags>;

export const DeviceProvisioning = z.object({
  deviceId: Ulid,
  serialNumber: z.string().max(64).nullable(),
  instituteProfileId: z.string().max(64), // resolved at runtime, never frozen (INV-DP-3) [D-02b]
  hallCode: z.string().max(32), // P-1 fact-check pending [D-20]
  hallDisplayName: z.string().max(128),
  titlePattern: z.string().max(128), // pattern is data, not code — P-1
  timezone: z.string().max(64), // IANA zone [D-17]
  ntpServers: z.array(z.string().max(128)), // [D-17]
  expectedStorageVolumeUuid: z.string().max(64).nullable(),
  featureFlags: FeatureFlags, // ownership deploy vs admin is DM-P3
  quizServerBaseUrl: z.string().max(256).nullable(), // null ⇒ quiz unavailable (LP-18)
  llmEndpoint: z.string().max(256).nullable(), // null ⇒ AI studio unavailable (LP-18)
  provisionedAt: Instant,
  provisionedBy: z.string().max(128).nullable(),
});
export type DeviceProvisioning = z.infer<typeof DeviceProvisioning>;
