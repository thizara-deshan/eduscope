import { z } from 'zod';
import { Cursor, Instant, Ulid } from './primitives';
import {
  AlertClearedReason,
  AlertSeverity,
  LogCategory,
  LogLevel,
  LogService,
} from './enums';

/** Context F — observability (domain model §9). */

/** AD-7 queryable log row. Context never contains secrets (INV-ST-1). */
export const LogEntry = z.object({
  id: Ulid,
  at: Instant,
  level: LogLevel,
  category: LogCategory,
  service: LogService,
  message: z.string(),
  context: z.record(z.unknown()).nullable(),
  sessionId: Ulid.nullable(),
  userId: Ulid.nullable(),
});
export type LogEntry = z.infer<typeof LogEntry>;

/** AD-7 query parameters (also the CSV-export filter set). */
export const LogQuery = z.object({
  level: LogLevel.optional(),
  category: LogCategory.optional(),
  q: z.string().max(256).optional(), // free-text search
  from: Instant.optional(),
  to: Instant.optional(),
  sessionId: Ulid.optional(),
  cursor: Cursor.optional(),
  limit: z.number().int().min(1).max(500).default(100),
});
export type LogQuery = z.infer<typeof LogQuery>;

/**
 * A current condition needing attention — distinct from the log, which is
 * history (INV-SA-2). Cannot be cleared while the condition is still true
 * (INV-SA-1, B-12's dead flag).
 */
export const SystemAlert = z.object({
  id: Ulid,
  code: z.string().max(64), // stable machine code, e.g. storage.critical
  severity: AlertSeverity,
  category: LogCategory,
  title: z.string().max(128), // plain language for a non-technical lecturer
  detail: z.string().nullable(),
  raisedAt: Instant,
  clearedAt: Instant.nullable(),
  clearedReason: AlertClearedReason.nullable(),
  acknowledgedBy: Ulid.nullable(),
  context: z.record(z.unknown()).nullable(),
  relatedEntity: z.object({ type: z.string(), id: z.string() }).nullable(),
});
export type SystemAlert = z.infer<typeof SystemAlert>;
