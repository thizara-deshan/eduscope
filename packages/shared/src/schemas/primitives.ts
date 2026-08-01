import { z } from 'zod';

/**
 * Contract v0.1.0 primitives.
 * Naming follows docs/design/domain-model.md exactly; every schema in this
 * directory is validated by both the Phase-2 mock adapter and the real backend.
 */

/** 26-char Crockford ULID. Opaque — no logic may depend on adjacency or ordering (INV-G-1/INV-G-2, DM-13). */
export const Ulid = z.string().ulid();
export type Ulid = z.infer<typeof Ulid>;

/** Instant: ISO-8601 with explicit offset, stored UTC (INV-G-3). */
export const Instant = z.string().datetime({ offset: true });
export type Instant = z.infer<typeof Instant>;

/** Opaque list cursor. */
export const Cursor = z.string().min(1);
export type Cursor = z.infer<typeof Cursor>;

/** Cursor-paginated list envelope shared by every list endpoint. */
export const page = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: Cursor.nullable(),
  });
