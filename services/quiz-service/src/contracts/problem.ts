import type { ZodType } from 'zod';
import type { Code, Problem } from '@eduscope/shared';

export interface ProblemOptions {
  detail?: string;
  meta?: Problem['meta'];
}

/**
 * Thrown by route/executor code to produce a contract-shaped `Problem`
 * response. Refusals are named (openapi.yaml Conventions) — every declared
 * or undeclared error path answers `application/problem+json`, never a
 * silent no-op.
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

/** Parses `value` against `schema`, raising a contract `validation.invalid` Problem on failure. */
export function parseBody<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new ProblemError(422, 'validation.invalid', 'Validation failed', { detail });
  }
  return result.data;
}
