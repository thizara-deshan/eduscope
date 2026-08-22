import type { Database as BetterSqlite3Database } from 'better-sqlite3';
import type { CommandAccepted, FirmwareUpdate } from '@eduscope/shared';
import { TIMERS } from '@eduscope/shared';
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ProblemError } from '../../contracts/problem.js';
import type { DrizzleDb } from '../../db/client.js';
import { firmwareUpdates, lectureSessions } from '../../db/schema.js';
import type { Clock } from '../../lib/clock.js';
import type { DomainBus } from '../../lib/domain-bus.js';
import type { HelperClient } from '../../lib/helper-client.js';
import type { IdGenerator } from '../../lib/ids.js';
import type { AuthContext } from '../auth/service.js';

/** state-machines.md §1: the non-terminal vocabulary a firmware apply refuses against, same set R-22/B-06 use. */
const NON_TERMINAL_STATES = ['starting', 'recording', 'paused', 'stopping', 'finalizing'] as const;

/**
 * The device's booted software version has no other source in this
 * workstream (no deploy-owned version file is part of the B-25/B-26
 * contract surface) — this seeds the singleton `FirmwareUpdate` row's
 * `currentVersion` the first time it is ever read, before any `applyFirmware`
 * has run. Every subsequent version comes from a completed apply.
 */
const INITIAL_FIRMWARE_VERSION = '0.1.0';

const zFirmwareCheckDetail = z.object({
  availableVersion: z.string().max(32).nullable(),
  artifactDigest: z.string().max(128).nullable(),
  signatureVerified: z.boolean(),
});

const zFirmwareApplyDetail = z.object({
  outcome: z.enum(['done', 'bad-signature', 'boot-failed']),
  rollbackVersion: z.string().max(32).nullable().optional(),
});

export interface FirmwareLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

export interface FirmwareDeps {
  db: DrizzleDb;
  clock: Clock;
  ids: IdGenerator;
  bus: DomainBus;
  helper: HelperClient;
  /** The raw `better-sqlite3` handle — `Database#backup()` safely snapshots WAL state, unlike a plain file copy. */
  raw: BetterSqlite3Database;
  /** Directory the pre-apply DB snapshot is written under; created on demand. */
  backupDir: string;
  logger?: FirmwareLogger;
}

function toPayload(row: typeof firmwareUpdates.$inferSelect): FirmwareUpdate {
  return {
    id: row.id,
    currentVersion: row.currentVersion,
    availableVersion: row.availableVersion,
    state: row.state,
    signatureVerified: row.signatureVerified,
    rollbackVersion: row.rollbackVersion,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    lastError: row.lastError,
  };
}

/** The one `FirmwareUpdate` row (AD-5, linear entity lifecycle — events.md §2.22). Created lazily on first read since no seed owns it. */
function getOrCreateFirmwareRow(deps: FirmwareDeps): typeof firmwareUpdates.$inferSelect {
  const existing = deps.db.select().from(firmwareUpdates).all()[0];
  if (existing) return existing;

  const now = deps.clock.now();
  const row = {
    id: deps.ids.next(now),
    currentVersion: INITIAL_FIRMWARE_VERSION,
    availableVersion: null,
    state: 'idle' as const,
    artifactDigest: null,
    signatureVerified: false,
    rollbackVersion: null,
    startedAt: null,
    finishedAt: null,
    lastError: null,
    startedBy: null,
  };
  deps.db.insert(firmwareUpdates).values(row).run();
  return row;
}

function publish(deps: FirmwareDeps, row: typeof firmwareUpdates.$inferSelect): void {
  deps.bus.publish('firmware.state', toPayload(row));
}

export function getFirmwareState(deps: FirmwareDeps): FirmwareUpdate {
  return toPayload(getOrCreateFirmwareRow(deps));
}

/** Only one check/apply cycle may be in flight at a time (idempotent when already at rest). */
function assertAtRest(row: typeof firmwareUpdates.$inferSelect): void {
  if (row.state !== 'idle' && row.state !== 'failed' && row.state !== 'done' && row.state !== 'rolled-back') {
    throw new ProblemError(409, 'conflict', 'A firmware check or update is already in progress');
  }
}

function accepted(deps: FirmwareDeps): CommandAccepted {
  const now = deps.clock.now();
  return { commandId: deps.ids.next(now), acceptedAt: now.toISOString(), resolveBySec: TIMERS['T-CMD-RESOLVE'] / 1000 };
}

/** INV-FU-1: checks the release channel through the allowlisted `firmware.check` helper verb; never applies anything itself. Idempotent — re-running while at rest just re-checks. */
export function checkFirmware(deps: FirmwareDeps, _actor: AuthContext): CommandAccepted {
  const row = getOrCreateFirmwareRow(deps);
  assertAtRest(row);

  const result = accepted(deps);
  void runCheck(deps, row.id).catch((error: unknown) => {
    deps.logger?.warn('firmware check failed unexpectedly', { error: error instanceof Error ? error.message : String(error) });
  });
  return result;
}

async function runCheck(deps: FirmwareDeps, rowId: string): Promise<void> {
  setState(deps, rowId, { state: 'checking' });

  let raw: { ok: true; detail: string };
  try {
    raw = await deps.helper.request('firmware.check', {}, deps.ids.next(deps.clock.now()));
  } catch (error) {
    setState(deps, rowId, { state: 'failed', lastError: error instanceof Error ? error.message : String(error) });
    return;
  }

  const parsed = zFirmwareCheckDetail.safeParse(JSON.parse(raw.detail));
  if (!parsed.success) {
    setState(deps, rowId, { state: 'failed', lastError: 'invalid firmware.check response' });
    return;
  }

  setState(deps, rowId, {
    state: 'idle',
    availableVersion: parsed.data.availableVersion,
    artifactDigest: parsed.data.artifactDigest,
    signatureVerified: parsed.data.signatureVerified,
    lastError: null,
  });
}

/**
 * INV-FU-2/INV-FU-3: refuses while a recording is active or nothing verified
 * is available, snapshots the DB before touching anything, then makes the one
 * allowlisted `firmware.apply` call — its outcome (done / bad-signature /
 * boot-failed→rolled-back) is the only source of truth for what actually
 * happened; A/B slot mechanics and signature verification stay helper/deploy
 * owned.
 */
export function applyFirmware(deps: FirmwareDeps, actor: AuthContext): CommandAccepted {
  const active = deps.db.select({ id: lectureSessions.id }).from(lectureSessions).where(inArray(lectureSessions.state, NON_TERMINAL_STATES)).get();
  if (active) {
    throw new ProblemError(409, 'conflict', 'Firmware apply refused while a recording is active');
  }

  const row = getOrCreateFirmwareRow(deps);
  assertAtRest(row);
  if (row.availableVersion === null || !row.signatureVerified) {
    throw new ProblemError(409, 'conflict', 'No verified firmware update is available to apply');
  }

  const result = accepted(deps);
  void runApply(deps, row.id, row.availableVersion, actor.userId).catch((error: unknown) => {
    deps.logger?.warn('firmware apply failed unexpectedly', { error: error instanceof Error ? error.message : String(error) });
  });
  return result;
}

async function runApply(deps: FirmwareDeps, rowId: string, targetVersion: string, actorUserId: string): Promise<void> {
  const startedAt = deps.clock.now().toISOString();
  setState(deps, rowId, { state: 'downloading', startedAt, finishedAt: null, lastError: null, startedBy: actorUserId });

  try {
    mkdirSync(deps.backupDir, { recursive: true });
    await deps.raw.backup(join(deps.backupDir, `pre-apply-${rowId}-${Date.now()}.db`));
  } catch (error) {
    setState(deps, rowId, { state: 'failed', finishedAt: deps.clock.now().toISOString(), lastError: `database backup failed: ${error instanceof Error ? error.message : String(error)}` });
    return;
  }

  setState(deps, rowId, { state: 'verifying' });
  setState(deps, rowId, { state: 'applying' });

  let raw: { ok: true; detail: string };
  try {
    raw = await deps.helper.request('firmware.apply', { version: targetVersion }, deps.ids.next(deps.clock.now()));
  } catch (error) {
    setState(deps, rowId, { state: 'failed', finishedAt: deps.clock.now().toISOString(), lastError: error instanceof Error ? error.message : String(error) });
    return;
  }

  const parsed = zFirmwareApplyDetail.safeParse(JSON.parse(raw.detail));
  const finishedAt = deps.clock.now().toISOString();
  if (!parsed.success) {
    setState(deps, rowId, { state: 'failed', finishedAt, lastError: 'invalid firmware.apply response' });
    return;
  }

  if (parsed.data.outcome === 'done') {
    setState(deps, rowId, { state: 'done', finishedAt, currentVersion: targetVersion, availableVersion: null, artifactDigest: null, lastError: null });
    return;
  }
  if (parsed.data.outcome === 'bad-signature') {
    setState(deps, rowId, { state: 'failed', finishedAt, lastError: 'signature verification failed' });
    return;
  }
  const rollbackRow = deps.db.select({ currentVersion: firmwareUpdates.currentVersion }).from(firmwareUpdates).where(eq(firmwareUpdates.id, rowId)).get();
  setState(deps, rowId, {
    state: 'rolled-back',
    finishedAt,
    rollbackVersion: parsed.data.rollbackVersion ?? rollbackRow?.currentVersion ?? null,
    lastError: 'device failed to boot into the new version and rolled back',
  });
}

function setState(deps: FirmwareDeps, rowId: string, patch: Partial<typeof firmwareUpdates.$inferInsert>): void {
  deps.db.update(firmwareUpdates).set(patch).where(eq(firmwareUpdates.id, rowId)).run();
  const row = deps.db.select().from(firmwareUpdates).where(eq(firmwareUpdates.id, rowId)).get()!;
  publish(deps, row);
}
