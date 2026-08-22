import type { DrizzleDb } from '../../db/client.js';
import { auditLogEntries } from '../../db/schema.js';
import type { Clock } from '../../lib/clock.js';
import type { IdGenerator } from '../../lib/ids.js';

/** Key names never persisted verbatim in an audit `before`/`after` snapshot (case-insensitive substring match — INV-ST-1/INV-AU-2). */
const SECRET_KEY_PATTERN = /password|passwordhash|secret|token|bearer|streamkey|apikey/i;
const REDACTED = '[redacted]';

/** Deep-redacts any object key matching {@link SECRET_KEY_PATTERN}; arrays and nested objects are walked, primitives pass through unchanged. */
export function redact<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => redact(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : redact(entry);
    }
    return result as T;
  }
  return value;
}

export interface AuditWriterDeps {
  db: DrizzleDb;
  clock: Clock;
  ids: IdGenerator;
}

export interface AuditWriteInput {
  actorUserId: string | null;
  actorKind: 'user' | 'system' | 'deploy';
  entityType: string;
  entityId: string;
  action: 'create' | 'edit' | 'discard' | 'regenerate' | 'send' | 'close' | 'delete' | 'import' | 'takeover' | 'config-change';
  sessionId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

/**
 * Thin redacting wrapper around `audit_log_entries` inserts (design/core-api.md
 * §12: "written inline in the owning executors, never from route handlers").
 * Existing owning executors already hand-pick safe fields for `before`/`after`;
 * this exists so a future caller cannot forget to strip a secret-shaped key.
 */
export class AuditWriter {
  readonly #deps: AuditWriterDeps;

  constructor(deps: AuditWriterDeps) {
    this.#deps = deps;
  }

  write(input: AuditWriteInput): void {
    const now = this.#deps.clock.now();
    this.#deps.db
      .insert(auditLogEntries)
      .values({
        id: this.#deps.ids.next(now),
        at: now.toISOString(),
        actorUserId: input.actorUserId,
        actorKind: input.actorKind,
        entityType: input.entityType,
        entityId: input.entityId,
        action: input.action,
        sessionId: input.sessionId ?? null,
        before: input.before === undefined ? null : redact(input.before),
        after: input.after === undefined ? null : redact(input.after),
        reason: input.reason ?? null,
      })
      .run();
  }
}
