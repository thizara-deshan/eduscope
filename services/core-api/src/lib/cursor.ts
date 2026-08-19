import { ProblemError } from '../contracts/problem.js';

/** The `(startedAt, id)` keyset a page boundary is built from (design/core-api.md §5.3). */
export interface KeysetCursor {
  startedAt: string;
  id: string;
}

/** Opaque to callers — encodes the last row's keyset so the next page can resume without an OFFSET scan. */
export function encodeCursor(cursor: KeysetCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

/** Rejects anything that doesn't decode to a `KeysetCursor` shape as a `validation.invalid` Problem — a cursor is never trusted as a raw query filter. */
export function decodeCursor(raw: string): KeysetCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw new ProblemError(422, 'validation.invalid', 'Invalid cursor');
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).startedAt !== 'string' ||
    typeof (parsed as Record<string, unknown>).id !== 'string'
  ) {
    throw new ProblemError(422, 'validation.invalid', 'Invalid cursor');
  }
  return parsed as KeysetCursor;
}
