import { createHash } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import type { DrizzleDb } from '../../db/client.js';
import { streamTargets } from '../../db/schema.js';
import type { Clock } from '../../lib/clock.js';
import type { HelperClient } from '../../lib/helper-client.js';
import type { IdGenerator } from '../../lib/ids.js';
import type { RelayTargetActivator } from '../channels/machine.js';

export interface RedactedRelayTarget {
  readonly id: string;
  readonly platform: 'youtube' | 'facebook' | 'custom-rtmp';
  readonly ingestUrl: string;
}

/**
 * Renders the effective relay push-target list: `configuredIds` in channel
 * order (streaming's `ChannelConfig.streamTargetIds`), deduplicated and
 * filtered down to targets that still exist and are `enabled` — a disabled,
 * deleted, or duplicate id is silently dropped rather than pushed (KEEP
 * B-59). Never carries the stream key (INV-ST-1) — that is resolved from the
 * secret store only for the privileged relay-template write this task does
 * not own (design/core-api.md §11, §8.1 `relay.reload`).
 */
export function renderRelayTargets(
  configuredIds: readonly string[],
  rows: readonly (typeof streamTargets.$inferSelect)[],
): RedactedRelayTarget[] {
  const byId = new Map(rows.filter((row) => row.enabled).map((row) => [row.id, row] as const));
  const seen = new Set<string>();
  const ordered: RedactedRelayTarget[] = [];
  for (const id of configuredIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const row = byId.get(id);
    if (!row) continue;
    ordered.push({ id: row.id, platform: row.platform, ingestUrl: row.ingestUrl });
  }
  return ordered;
}

/** A deterministic digest over the redacted, ordered target list — identical input always yields the identical digest, so an unrelated field edit never bounces the relay. */
export function digestRelayTargets(targets: readonly RedactedRelayTarget[]): string {
  return createHash('sha256').update(JSON.stringify(targets)).digest('hex');
}

export interface RelayConfigDeps {
  db: DrizzleDb;
  helper: HelperClient;
  clock: Clock;
  ids: IdGenerator;
}

/**
 * The real `RelayTargetActivator` (design/core-api.md §11, §8.1): renders the
 * currently-active streaming channel's configured target ids against live DB
 * state, hashes the redacted result, and calls the allowlisted
 * `relay.reload {configDigest}` helper verb only when that digest actually
 * changed (INV-ST-3 — an edit that leaves the effective push set unchanged
 * never reloads, so it never interrupts the local recording or the current
 * live consumer). `refresh()` lets stream-target CRUD reload mid-stream
 * without going through `activate()`/`deactivate()`, which stay owned by the
 * channel executor's start/stop lifecycle.
 */
export class RelayConfigActivator implements RelayTargetActivator {
  readonly #deps: RelayConfigDeps;
  #activeConfiguredIds: readonly string[] | null = null;
  #lastDigest: string | null = null;

  constructor(deps: RelayConfigDeps) {
    this.#deps = deps;
  }

  async activate(streamTargetIds: readonly string[]): Promise<void> {
    this.#activeConfiguredIds = streamTargetIds;
    await this.#reload();
  }

  async deactivate(): Promise<void> {
    this.#activeConfiguredIds = null;
    await this.#reload();
  }

  /** Re-renders from current DB state without changing which channel-configured ids are active — a no-op while the streaming channel is off (`activate()` has not run since the last `deactivate()`), so a stream-target edit made while nothing is live never reaches the helper. */
  async refresh(): Promise<void> {
    if (this.#activeConfiguredIds === null) return;
    await this.#reload();
  }

  async #reload(): Promise<void> {
    const configuredIds = this.#activeConfiguredIds ?? [];
    const rows = configuredIds.length === 0 ? [] : this.#deps.db.select().from(streamTargets).where(inArray(streamTargets.id, configuredIds)).all();
    const targets = renderRelayTargets(configuredIds, rows);
    const digest = digestRelayTargets(targets);
    if (digest === this.#lastDigest) return;

    const now = this.#deps.clock.now();
    await this.#deps.helper.request('relay.reload', { configDigest: digest }, this.#deps.ids.next(now));
    this.#lastDigest = digest;
  }
}
