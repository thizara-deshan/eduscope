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
