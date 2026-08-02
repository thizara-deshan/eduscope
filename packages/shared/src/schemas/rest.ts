/**
 * The zod mirror of contracts/openapi.yaml, promised by that file's Conventions
 * block ("The zod mirror of every schema lives in packages/shared/src/schemas/").
 *
 * `generated/` is codegen output — never edit it. If the generator's identifiers
 * do not match the contract names, adapt them HERE and only here; the coverage
 * test in test/rest-coverage.test.ts is the gate.
 */
import { z } from 'zod';

export * from './generated/zod.gen.js';
export type * from './generated/types.gen.js';

/** Cursor pagination envelope (openapi.yaml Conventions: `{ items, nextCursor }`). */
export const zPage = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

export type Page<T> = { items: T[]; nextCursor: string | null };
