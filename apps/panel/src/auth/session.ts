import type { Problem, SessionRevokedReason } from '@eduscope/shared';

/**
 * What a navigation TO /login may carry. `from` is already produced by
 * `require-role.tsx:22`; `reason` is produced by a sign-out and by
 * `useSessionRevocation`, and words S-01's message slot (S-01 §6).
 */
export interface LoginLocationState {
  readonly from?: string;
  readonly reason?: SessionRevokedReason;
}

/** The boundary throws ProblemError; components only ever see `unknown`. */
export function asProblem(error: unknown): Problem | null {
  const problem = (error as { problem?: Problem } | null | undefined)?.problem;
  return problem && typeof problem.code === 'string' ? problem : null;
}

/**
 * Anything the boundary rejects with that is NOT a Problem never reached the
 * application layer: `TransportError` from the mock, a `TypeError` from fetch in
 * the real adapter. Both are S-01's `backend unreachable`, never a refusal —
 * U-5's "named reason in plain language" only applies to things with a name.
 */
export const isTransportFailure = (error: unknown): boolean => asProblem(error) === null;

/**
 * CG-11: the contract sets `meta.reason` on `auth.session-revoked` only, and on
 * every occurrence of it. The `?? 'expired'` is a belt-and-braces default for a
 * non-conforming server, not an expected path.
 */
export function revokedReason(error: unknown): SessionRevokedReason | null {
  const problem = asProblem(error);
  if (!problem || problem.code !== 'auth.session-revoked') return null;
  const reason = (problem.meta as { reason?: SessionRevokedReason } | undefined)?.reason;
  return reason ?? 'expired';
}
