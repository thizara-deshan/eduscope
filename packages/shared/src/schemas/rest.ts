/**
 * The zod mirror of contracts/openapi.yaml, promised by that file's Conventions
 * block ("The zod mirror of every schema lives in packages/shared/src/schemas/").
 *
 * `generated/` is codegen output — never edit it. If the generator's identifiers
 * do not match the contract names, adapt them HERE and only here; the coverage
 * test in test/rest-coverage.test.ts is the gate.
 */
import { z } from 'zod';
import * as generated from './generated/zod.gen.js';

export * from './generated/zod.gen.js';
export type * from './generated/types.gen.js';

/** Cursor pagination envelope (openapi.yaml Conventions: `{ items, nextCursor }`). */
export const zPage = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

export type Page<T> = { items: T[]; nextCursor: string | null };

// ── behavior adapter: additionalProperties: true fields ────────────────────
// contracts/openapi.yaml declares exactly three fields as open-ended objects
// (`additionalProperties: true`): Problem.meta, LogEntry.context, and
// SystemAlert.context. The generator renders these as bare `z.object({})`,
// and zod's default object mode is "strip" — any keys a real payload puts in
// `meta`/`context` would silently vanish on `.parse()`, contradicting
// frontend-conventions.md §5's promise that validation preserves real
// content. Override here (never in generated/zod.gen.ts): `.catchall()`
// keeps unknown keys instead of stripping them.
const zOpenObject = z.object({}).catchall(z.unknown());

// Problem.meta is no longer *bare* open-ended: since v0.2 (CG-11 / S01-D-5) it
// declares one typed key, `reason: SessionRevokedReason`, alongside
// `additionalProperties: true`. So the override is built FROM the generated
// shape rather than replacing it with `zOpenObject` — replacing it would throw
// the contract's own typing away and re-open the drift this file exists to
// close. Adding another declared key to `meta` upstream needs no edit here.
export const zProblem = generated.zProblem.extend({
  meta: generated.zProblem.shape.meta.unwrap().catchall(z.unknown()).optional(),
});

export const zLogEntry = generated.zLogEntry.extend({
  context: zOpenObject.nullable(),
});

export const zSystemAlert = generated.zSystemAlert.extend({
  context: zOpenObject.nullable(),
});
