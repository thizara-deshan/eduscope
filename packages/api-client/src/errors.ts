import type { Problem } from '@eduscope/shared';

/** Thrown by createRealClient. The interface is honest: unimplemented is loud. */
export class NotImplementedError extends Error {
  constructor(operation: string, phase = 'Phase 4') {
    super(`${operation} is not implemented until ${phase}`);
    this.name = 'NotImplementedError';
  }
}

/**
 * application/problem+json (openapi.yaml Conventions). Refusals are NAMED —
 * never a silent no-op (R-04, INV-SB-3, universal state U-5).
 */
export class ProblemError extends Error {
  readonly problem: Problem;
  constructor(problem: Problem) {
    super(`${problem.code}: ${problem.title}`);
    this.name = 'ProblemError';
    this.problem = problem;
  }
}

/**
 * A request that never reached an application layer: no status, no
 * `application/problem+json` body, nothing to name in a refusal message.
 *
 * This is the distinction S-01's `backend unreachable` turns on — "the device is
 * up and core-api is not" (screen-inventory §2 S-01) is NOT a refusal, and
 * rendering it as one would tell a lecturer their credentials were wrong.
 */
export class TransportError extends Error {
  readonly operation: string;
  constructor(operation: string, options?: { cause?: unknown }) {
    super(`${operation}: the device API is unreachable`, options);
    this.name = 'TransportError';
    this.operation = operation;
  }
}
