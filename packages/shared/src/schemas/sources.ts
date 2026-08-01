import { z } from 'zod';
import { Instant, Ulid } from './primitives';
import {
  AppliedState,
  PhysicalInputKind,
  PresenceState,
  SourceHealthState,
  SourceMedium,
  SourceRoleId,
} from './enums';

/** Context A — source mapping (domain model §4.5–4.8). */

/** Seeded reference entity — immutable at runtime (INV-SR-1). */
export const SourceRole = z.object({
  id: SourceRoleId,
  medium: SourceMedium,
  displayLabel: z.string().max(32), // PC, CAM 1, CAM 2, Lecturer Mic
  requiredForStart: z.boolean(), // false for all in V1 (A-08)
  provisionable: z.boolean(), // mic-room = false (A-08 amended, DM-11)
});
export type SourceRole = z.infer<typeof SourceRole>;

/** A concrete capture endpoint. AD-2 camera-IP edits write `address` here — exactly once (INV-PI-2). */
export const PhysicalInput = z.object({
  id: Ulid,
  kind: PhysicalInputKind,
  address: z.string().max(512),
  /** Reference into the secret store; the credential itself is never returned (PF-17). */
  credentialRef: z.string().max(128).nullable(),
  transport: z.enum(['tcp', 'udp']).nullable(), // rtsp only; tcp default
  expectedCodec: z.enum(['h264', 'raw-nv12', 's16le']).nullable(),
  stableIdentifier: z.string().max(256).nullable(),
  /** Projection from pipeline-manager telemetry only (INV-PI-3). */
  presenceState: PresenceState,
  lastSeenAt: Instant.nullable(),
  updatedAt: Instant,
});
export type PhysicalInput = z.infer<typeof PhysicalInput>;

/** AD-2: only the address (+ credentials/transport) is admin-editable; presence is telemetry. */
export const PhysicalInputUpdate = z.object({
  address: z.string().min(1).max(512).optional(),
  credentialRef: z.string().max(128).nullable().optional(),
  transport: z.enum(['tcp', 'udp']).nullable().optional(),
});
export type PhysicalInputUpdate = z.infer<typeof PhysicalInputUpdate>;

/** Role → input mapping; a provisioning act, never per-session (INV-SB-2). */
export const SourceBinding = z.object({
  roleId: SourceRoleId,
  physicalInputId: Ulid.nullable(), // null = deliberately unbound
  enabled: z.boolean(),
  updatedAt: Instant,
});
export type SourceBinding = z.infer<typeof SourceBinding>;

export const SourceBindingUpdate = z.object({
  physicalInputId: Ulid.nullable(),
  enabled: z.boolean(),
});
export type SourceBindingUpdate = z.infer<typeof SourceBindingUpdate>;

/**
 * Combined health view per role for panel tiles (machine 5a). Delivered over
 * `sources.status`; this shape is also the REST snapshot row.
 */
export const SourceStatus = z.object({
  roleId: SourceRoleId,
  state: SourceHealthState,
  detail: z.string().nullable(), // e.g. "reconnecting…" (HL-04)
  since: Instant,
  inputId: Ulid.nullable(),
});
export type SourceStatus = z.infer<typeof SourceStatus>;

/** LP-9 — the verifiably-effective mic control (kills the B-55 placebo). */
export const AudioControl = z.object({
  roleId: SourceRoleId, // mic-lecturer only in V1
  gain: z.number().int().min(0).max(100),
  /** Room Controls master mute writes this same field — one control, one truth (LP-14, [D-10]). */
  muted: z.boolean(),
  /** The UI shows ACTUAL applied state, never assumed success (INV-AC-1, B-12 lesson). */
  appliedState: AppliedState,
  lastAppliedAt: Instant.nullable(),
  lastError: z.string().nullable(),
});
export type AudioControl = z.infer<typeof AudioControl>;

export const AudioControlUpdate = z
  .object({
    gain: z.number().int().min(0).max(100).optional(),
    muted: z.boolean().optional(),
  })
  .refine((v) => v.gain !== undefined || v.muted !== undefined, {
    message: 'gain or muted required',
  });
export type AudioControlUpdate = z.infer<typeof AudioControlUpdate>;
