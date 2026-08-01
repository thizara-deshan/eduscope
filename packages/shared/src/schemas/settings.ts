import { z } from 'zod';
import { Instant, Ulid } from './primitives';
import { AddressMode, ChannelId, NetworkKind, StreamPlatform } from './enums';

/** Context A — admin settings groups (AD-2 network, AD-3 encoder, AD-8 streaming). */

// ── Network (AD-2) ──────────────────────────────────────────────────────────

/** No Wi-Fi/SSID fields exist [D-16] (INV-NC-1). Camera addresses live on PhysicalInput, not here (INV-NC-3). */
export const NetworkConfig = z.object({
  id: Ulid,
  interfaceName: z.string().max(32),
  kind: NetworkKind, // vlan is NEW
  vlanId: z.number().int().min(1).max(4094).nullable(), // required iff kind = vlan
  addressMode: AddressMode,
  ipv4Address: z.string().max(64).nullable(), // required iff static
  prefixLength: z.number().int().min(0).max(32).nullable(),
  gateway: z.string().max(64).nullable(),
  dnsServers: z.array(z.string().max(64)),
  appliedAt: Instant.nullable(),
  /** Surfaced in Admin, not swallowed. */
  lastApplyError: z.string().nullable(),
});
export type NetworkConfig = z.infer<typeof NetworkConfig>;

/** Apply never rebuilds the SPA or bakes a base URL (INV-NC-2, B-46/B-61). */
export const NetworkConfigUpdate = z.object({
  kind: NetworkKind.optional(),
  vlanId: z.number().int().min(1).max(4094).nullable().optional(),
  addressMode: AddressMode.optional(),
  ipv4Address: z.string().max(64).nullable().optional(),
  prefixLength: z.number().int().min(0).max(32).nullable().optional(),
  gateway: z.string().max(64).nullable().optional(),
  dnsServers: z.array(z.string().max(64)).optional(),
});
export type NetworkConfigUpdate = z.infer<typeof NetworkConfigUpdate>;

// ── Encoder (AD-3) ──────────────────────────────────────────────────────────

/** Values restricted to what the RK3588 `mpph264enc` actually supports (INV-EP-1). */
export const EncodingProfile = z.object({
  id: Ulid,
  scope: z.enum(['device-default', 'channel']), // per-channel override is DM-P4 (open)
  channelId: ChannelId.nullable(),
  videoBitrateKbps: z.number().int().min(2000).max(8000), // AD-3
  framerate: z.number().int().positive(),
  gop: z.number().int().positive(),
  rateControl: z.enum(['cbr', 'vbr']),
  codec: z.literal('h264'),
  container: z.enum(['mpegts', 'mp4', 'flv']),
  audioCodec: z.literal('aac'),
  audioBitrateKbps: z.number().int().positive(),
  capabilityVerifiedAt: Instant.nullable(), // null ⇒ not yet probed on this hardware
});
export type EncodingProfile = z.infer<typeof EncodingProfile>;

/**
 * Capability-probed option sets — the UI renders ONLY these (AD-3: unsupported
 * values are absent, not inert; B-56 lesson).
 */
export const EncoderCapabilities = z.object({
  videoBitrateKbps: z.object({ min: z.number().int(), max: z.number().int() }),
  framerates: z.array(z.number().int()),
  gops: z.array(z.number().int()),
  rateControls: z.array(z.enum(['cbr', 'vbr'])),
  codecs: z.array(z.literal('h264')),
  audioBitratesKbps: z.array(z.number().int()),
});
export type EncoderCapabilities = z.infer<typeof EncoderCapabilities>;

export const EncodingProfileUpdate = z.object({
  videoBitrateKbps: z.number().int().min(2000).max(8000).optional(),
  framerate: z.number().int().positive().optional(),
  gop: z.number().int().positive().optional(),
  rateControl: z.enum(['cbr', 'vbr']).optional(),
  audioBitrateKbps: z.number().int().positive().optional(),
});
export type EncodingProfileUpdate = z.infer<typeof EncodingProfileUpdate>;

// ── Streaming targets (AD-8) ────────────────────────────────────────────────

/**
 * Read view: the stream key NEVER appears in any response, log line or event
 * (INV-ST-1, PF-17). `hasStreamKey` tells the UI whether one is stored.
 */
export const StreamTarget = z.object({
  id: Ulid,
  platform: StreamPlatform, // [D-19]
  displayName: z.string().max(64),
  ingestUrl: z.string().max(512),
  hasStreamKey: z.boolean(),
  requiresTlsBridge: z.boolean(), // RTMPS via stunnel4 (B-58)
  enabled: z.boolean(),
  lastPreflightAt: Instant.nullable(), // A-10 check_live successor
  lastPreflightResult: z.enum(['ok', 'failed']).nullable(),
});
export type StreamTarget = z.infer<typeof StreamTarget>;

/** streamKey is write-only; omitted on update ⇒ unchanged. */
export const StreamTargetCreate = z.object({
  platform: StreamPlatform,
  displayName: z.string().min(1).max(64),
  ingestUrl: z.string().min(1).max(512),
  streamKey: z.string().min(1).max(512),
  enabled: z.boolean().default(true),
});
export type StreamTargetCreate = z.infer<typeof StreamTargetCreate>;

export const StreamTargetUpdate = z.object({
  platform: StreamPlatform.optional(),
  displayName: z.string().min(1).max(64).optional(),
  ingestUrl: z.string().min(1).max(512).optional(),
  streamKey: z.string().min(1).max(512).optional(),
  enabled: z.boolean().optional(),
});
export type StreamTargetUpdate = z.infer<typeof StreamTargetUpdate>;
