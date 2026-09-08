/**
 * `application/problem+json` parsing for the real transport. A refusal is only a
 * `ProblemError` when the body actually validates as the contract's `Problem`
 * (the hand-authored `zProblem` override, which keeps `meta`'s open keys). A
 * non-2xx with no problem body, or a malformed one, is a `TransportError` — the
 * boundary never invents a named refusal it cannot read.
 */
import { zProblem, type Problem } from '@eduscope/shared';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

export function isProblemContentType(contentType: string | null): boolean {
  return (contentType ?? '').toLowerCase().includes('application/problem+json');
}

export function parseProblem(body: unknown): Problem | null {
  const parsed = zProblem.safeParse(body);
  // The validated shape is a `Problem`; the cast only bridges a codegen
  // optional/required difference between `zod.gen` and `types.gen`.
  return parsed.success ? (parsed.data as Problem) : null;
}
