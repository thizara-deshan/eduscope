import type { LogCategory, SystemAlert } from '@eduscope/shared';
import { TIMERS } from '@eduscope/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { DrizzleDb } from '../../db/client.js';
import { logEntries, systemAlerts } from '../../db/schema.js';
import type { Cancel, Clock } from '../../lib/clock.js';
import type { DomainBus } from '../../lib/domain-bus.js';
import type { IdGenerator } from '../../lib/ids.js';
import type { LifecycleComponent, LifecycleStopReason } from '../../lifecycle.js';

export interface RaiseAlertInput {
  code: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  category: LogCategory;
  title: string;
  detail?: string | null;
  context?: Record<string, unknown> | null;
  relatedEntity?: { type: string; id: string } | null;
}

/** A standing condition this store re-checks every `T-ALERT-REEVALUATE` (INV-SA-1): `null` clears the code, a `RaiseAlertInput` (re-)raises it. */
export type AlertCondition = () => RaiseAlertInput | null;

function toPublic(row: typeof systemAlerts.$inferSelect): SystemAlert {
  return {
    id: row.id,
    code: row.code,
    severity: row.severity,
    category: row.category,
    title: row.title,
    detail: row.detail,
    raisedAt: row.raisedAt,
    clearedAt: row.clearedAt,
    clearedReason: row.clearedReason,
    acknowledgedBy: row.acknowledgedBy,
    context: (row.context as Record<string, unknown> | null) ?? null,
    relatedEntity: row.relatedEntity,
  };
}

export interface AlertStoreDeps {
  db: DrizzleDb;
  clock: Clock;
  ids: IdGenerator;
  bus: DomainBus;
  logger?: { warn(message: string, meta?: Record<string, unknown>): void };
}

/**
 * The `SystemAlert` store (design/core-api.md §8 "Alerts"): current
 * conditions, distinct from the log (INV-SA-2 — every raise/clear also
 * writes a `LogEntry`). Deduplicates by `code` (INV-SA-1: a still-true
 * condition never grows a second active row) and re-runs every registered
 * `AlertCondition` on `T-ALERT-REEVALUATE` so a condition that never clears
 * keeps re-raising rather than silently going stale.
 */
export class AlertStore implements LifecycleComponent {
  readonly name = 'alert-store';

  readonly #deps: AlertStoreDeps;
  readonly #conditions = new Map<string, AlertCondition>();
  #timer: Cancel | null = null;

  constructor(deps: AlertStoreDeps) {
    this.#deps = deps;
  }

  async start(): Promise<void> {
    this.#reevaluateAll();
    this.#timer = this.#deps.clock.every(TIMERS['T-ALERT-REEVALUATE'], () => this.#reevaluateAll());
  }

  async stop(_reason: LifecycleStopReason): Promise<void> {
    this.#timer?.cancel();
    this.#timer = null;
  }

  /** Registers a standing condition, checked immediately at the next reevaluation pass (including the one `start()` runs). */
  registerCondition(code: string, condition: AlertCondition): void {
    this.#conditions.set(code, condition);
  }

  list(includeCleared: boolean): SystemAlert[] {
    const rows = includeCleared
      ? this.#deps.db.select().from(systemAlerts).all()
      : this.#deps.db.select().from(systemAlerts).where(isNull(systemAlerts.clearedAt)).all();
    return rows.map(toPublic);
  }

  /** Idempotent by `code` (INV-SA-1): a call while the code is already active is a no-op that returns the existing row unchanged. */
  raise(input: RaiseAlertInput): SystemAlert {
    const active = this.#deps.db
      .select()
      .from(systemAlerts)
      .where(and(eq(systemAlerts.code, input.code), isNull(systemAlerts.clearedAt)))
      .get();
    if (active) return toPublic(active);

    const now = this.#deps.clock.now();
    const nowIso = now.toISOString();
    const id = this.#deps.ids.next(now);
    this.#deps.db
      .insert(systemAlerts)
      .values({
        id,
        code: input.code,
        severity: input.severity,
        category: input.category,
        title: input.title,
        detail: input.detail ?? null,
        raisedAt: nowIso,
        clearedAt: null,
        clearedReason: null,
        acknowledgedBy: null,
        context: input.context ?? null,
        relatedEntity: input.relatedEntity ?? null,
      })
      .run();
    this.#writeLog(input, nowIso);

    const row = toPublic(this.#deps.db.select().from(systemAlerts).where(eq(systemAlerts.id, id)).get()!);
    this.#deps.bus.publish('system.alert', row);
    return row;
  }

  /** Clears every currently-active alert with this `code`. A no-op if none is active. */
  clear(code: string, reason: 'resolved' | 'superseded'): void {
    const now = this.#deps.clock.now();
    const nowIso = now.toISOString();
    const active = this.#deps.db
      .select()
      .from(systemAlerts)
      .where(and(eq(systemAlerts.code, code), isNull(systemAlerts.clearedAt)))
      .all();
    for (const row of active) {
      this.#deps.db.update(systemAlerts).set({ clearedAt: nowIso, clearedReason: reason }).where(eq(systemAlerts.id, row.id)).run();
      const updated = toPublic(this.#deps.db.select().from(systemAlerts).where(eq(systemAlerts.id, row.id)).get()!);
      this.#writeLog({ code, severity: row.severity, category: row.category, title: `${row.title} (cleared)`, detail: reason }, nowIso);
      this.#deps.bus.publish('system.alert', updated);
    }
  }

  /** Records the acknowledging actor; a still-true condition re-raises on the next `T-ALERT-REEVALUATE` pass regardless (INV-SA-1) — acknowledgement never clears. */
  acknowledge(alertId: string, actorUserId: string): SystemAlert {
    const row = this.#deps.db.select().from(systemAlerts).where(eq(systemAlerts.id, alertId)).get();
    if (!row) throw new Error(`alert ${alertId} not found`);
    this.#deps.db.update(systemAlerts).set({ acknowledgedBy: actorUserId }).where(eq(systemAlerts.id, alertId)).run();
    return toPublic(this.#deps.db.select().from(systemAlerts).where(eq(systemAlerts.id, alertId)).get()!);
  }

  #reevaluateAll(): void {
    for (const [code, condition] of this.#conditions) {
      let result: RaiseAlertInput | null;
      try {
        result = condition();
      } catch (error) {
        this.#deps.logger?.warn('alert condition threw', { code, error: error instanceof Error ? error.message : String(error) });
        continue;
      }
      if (result) this.raise(result);
      else this.clear(code, 'resolved');
    }
  }

  #writeLog(input: Pick<RaiseAlertInput, 'code' | 'severity' | 'category' | 'title' | 'detail'>, nowIso: string): void {
    const level = input.severity === 'critical' || input.severity === 'error' ? 'ERROR' : input.severity === 'warning' ? 'WARN' : 'INFO';
    this.#deps.db
      .insert(logEntries)
      .values({
        id: this.#deps.ids.next(this.#deps.clock.now()),
        at: nowIso,
        level,
        category: input.category,
        service: 'core-api',
        message: `${input.code}: ${input.title}`,
        context: input.detail ? { detail: input.detail } : null,
      })
      .run();
  }
}
