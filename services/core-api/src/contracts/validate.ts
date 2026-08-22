import type { ZodType } from 'zod';
import { ProblemError } from './problem.js';

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
