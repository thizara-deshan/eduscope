import type { Code, Problem } from '@eduscope/shared';

export interface ProblemOptions {
  detail?: string;
  meta?: Problem['meta'];
}

/**
 * Thrown by route/executor code to produce a contract-shaped `Problem`
 * response. The one path (besides `ZodError`) the app-level error handler
 * converts to `application/problem+json` (openapi.yaml Conventions: "Refusals
 * are named").
 */
export class ProblemError extends Error {
  readonly status: number;
  readonly code: Code;
  readonly title: string;
  readonly detail?: string;
  readonly meta?: Problem['meta'];

  constructor(status: number, code: Code, title: string, options: ProblemOptions = {}) {
    super(title);
    this.name = 'ProblemError';
    this.status = status;
    this.code = code;
    this.title = title;
    if (options.detail !== undefined) this.detail = options.detail;
    if (options.meta !== undefined) this.meta = options.meta;
  }

  toBody(): Problem {
    const body: Problem = { status: this.status, code: this.code, title: this.title };
    if (this.detail !== undefined) body.detail = this.detail;
    if (this.meta !== undefined) body.meta = this.meta;
    return body;
  }
}
