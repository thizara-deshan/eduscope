import { z } from 'zod';
import { Instant, Ulid } from './primitives';
import { ImportBatchState, UserRole } from './enums';

/** Context B — user management (AD-6). The User read view lives in auth.ts. */

export const UserCreate = z.object({
  username: z.string().min(1).max(128),
  displayName: z.string().min(1).max(128), // never defaulted to username (B-21)
  role: UserRole,
  /** Initial password; the user hits forced reset on first login regardless (AD-6, LP-2). */
  password: z.string().min(8).max(256),
});
export type UserCreate = z.infer<typeof UserCreate>;

export const UserUpdate = z.object({
  displayName: z.string().min(1).max(128).optional(),
  role: UserRole.optional(),
  disabled: z.boolean().optional(),
  /** Setting a password forces a reset on next login (mustResetPassword = true). */
  password: z.string().min(8).max(256).optional(),
});
export type UserUpdate = z.infer<typeof UserUpdate>;

export const ImportRejection = z.object({
  row: z.number().int().positive(),
  column: z.string().max(64),
  reason: z.enum([
    'empty-cell', // B-44: reject null cells
    'duplicate-username-in-file', // B-44: in-file duplicates
    'username-exists', // INV-U-2
    'invalid-role',
    'invalid-format',
  ]),
});
export type ImportRejection = z.infer<typeof ImportRejection>;

/**
 * One Excel bulk import (domain model §5.3). All-or-nothing: any invalid row ⇒
 * state `rejected` and no users written (INV-UI-1). The uploaded file is not
 * retained (INV-UI-3).
 */
export const UserImportBatch = z.object({
  id: Ulid,
  filename: z.string().max(256),
  uploadedAt: Instant,
  state: ImportBatchState,
  rowCount: z.number().int().nonnegative(),
  acceptedCount: z.number().int().nonnegative(),
  rejections: z.array(ImportRejection), // empty when applied
});
export type UserImportBatch = z.infer<typeof UserImportBatch>;
