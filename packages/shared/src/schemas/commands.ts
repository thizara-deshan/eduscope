import { z } from 'zod';
import { Instant, Ulid } from './primitives';

/**
 * Command + error envelopes.
 *
 * Rule SM-R-2 / target-architecture §3.1: state-machine commands NEVER return
 * final state synchronously. They return 202 + CommandAccepted; the resulting
 * transition arrives over the WS event channel. If nothing arrives within
 * `resolveBySec` (T-CMD-RESOLVE, 10 s) the UI must render a failure — never an
 * indefinite spinner.
 */
export const CommandAccepted = z.object({
  commandId: Ulid,
  acceptedAt: Instant,
  /** Seconds until the client must treat the command as failed (T-CMD-RESOLVE). */
  resolveBySec: z.number().int().positive(),
});
export type CommandAccepted = z.infer<typeof CommandAccepted>;

/**
 * Stable machine-readable error codes. Class A start refusals (§0.4 of
 * state-machines.md) are command rejections carrying one of these codes plus a
 * named, human-readable reason — never a silent no-op (R-02…R-04, INV-SB-3).
 */
export const ErrorCode = z.enum([
  // auth
  'auth.invalid-credentials',
  'auth.session-revoked', // INV-AS-2
  'auth.password-reset-required', // INV-U-3 — every surface except the reset flow
  'not-authorized', // INV-U-4, G-ADMIN, G-AUTH-OWNER
  'not-found',
  'validation.invalid',
  'conflict',
  // recording start refusals — Class A (§0.4)
  'recorder.busy', // R-03 — payload meta carries owner displayName + title (LP-6)
  'storage.critical', // R-02 [D-15]
  'provisioning.incomplete', // R-04, INV-DP-2
  'volume.unavailable', // R-04, G-VOLUME-MOUNTED
  'config.invalid', // R-04, INV-CC-3 — meta names the unbound role / invalid preset
  'session.not-active',
  // AI / quiz
  'question.immutable', // INV-Q-4 — edit of sent/closed rejected, and audited
  'quiz.unavailable', // Q-30 guard, Z-03
  'ai.unavailable', // G-AI-ENABLED false (LP-18)
  // device ops
  'poweroff.refused', // R-22
  'format.refused', // INV-SV-3 — refused while any session is non-terminal
  'export.invalid-target', // INV-EX-2
  // uploads / imports
  'upload.not-requeueable', // U-09 guard: only dead-letter is requeueable
  'import.rejected', // INV-UI-1 — all-or-nothing
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

/** application/problem+json body for every non-2xx response. */
export const Problem = z.object({
  status: z.number().int(),
  code: ErrorCode,
  title: z.string(),
  detail: z.string().optional(),
  /**
   * Named-reason detail, e.g. { roleId: 'lecturer-cam' } for config.invalid,
   * { ownerDisplayName, sessionTitle } for recorder.busy (LP-6 locked view).
   * Never contains secret-grade values (INV-ST-1).
   */
  meta: z.record(z.unknown()).optional(),
});
export type Problem = z.infer<typeof Problem>;
