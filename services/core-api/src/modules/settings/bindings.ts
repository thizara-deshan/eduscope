import { and, eq, ne } from 'drizzle-orm';
import type { PhysicalInput, SourceBinding, SourceRoleId } from '@eduscope/shared';
import { ProblemError } from '../../contracts/problem.js';
import type { DrizzleDb } from '../../db/client.js';
import { auditLogEntries, physicalInputs, sourceBindings } from '../../db/schema.js';
import type { Clock } from '../../lib/clock.js';
import type { IdGenerator } from '../../lib/ids.js';
import type { SecretStore } from '../../lib/secret-store.js';
import type { AuthContext } from '../auth/service.js';
import type { PipelineManagerClient } from '../recording/pm/client.js';
import type { PmPublisherId } from '../recording/pm/types.js';
import type { SourceExecutor } from '../sources/status.js';

/** pipeline-manager.md §1.1 — the inverse of `sources/status.ts#PM_PUBLISHER_TO_ROLE`; `mic-room` has no publisher (INV-SR-2, A-08 amended). */
export const ROLE_TO_PM_PUBLISHER: Partial<Record<SourceRoleId, PmPublisherId>> = {
  presentation: 'usb',
  'lecturer-cam': 'rtsp',
  'students-cam': 'rtsp2',
  'mic-lecturer': 'audio',
};

export interface BindingsLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

export interface BindingsDeps {
  db: DrizzleDb;
  clock: Clock;
  ids: IdGenerator;
  secrets: SecretStore;
  pm: PipelineManagerClient;
  sources: SourceExecutor;
  logger?: BindingsLogger;
}

export function toPhysicalInputPayload(row: typeof physicalInputs.$inferSelect): PhysicalInput {
  return {
    id: row.id,
    kind: row.kind,
    address: row.address,
    credentialRef: row.credentialRef,
    transport: row.transport,
    expectedCodec: row.expectedCodec,
    stableIdentifier: row.stableIdentifier,
    presenceState: row.presenceState,
    lastSeenAt: row.lastSeenAt,
    updatedAt: row.updatedAt,
  };
}

export function toSourceBindingPayload(row: typeof sourceBindings.$inferSelect): SourceBinding {
  return { roleId: row.roleId as SourceRoleId, physicalInputId: row.physicalInputId, enabled: row.enabled, updatedAt: row.updatedAt };
}

/**
 * Pushes the fully resolved binding (address + secret-store-decrypted
 * credentials, never a raw secret from the caller) to A outside the DB
 * transaction that made it canonical. Failure never rolls back that
 * transaction (design/core-api.md §11: "keep one canonical config copy") —
 * it only gets logged; the caller still re-probes the role so a failed push
 * is never reported as healthy (INV-DH-2).
 */
async function pushBindingToPm(deps: BindingsDeps, roleId: SourceRoleId, input: typeof physicalInputs.$inferSelect): Promise<void> {
  const publisherId = ROLE_TO_PM_PUBLISHER[roleId];
  if (!publisherId) return;

  let credentials: { username: string; password: string } | undefined;
  if (input.credentialRef) {
    const secret = deps.secrets.get(input.credentialRef);
    if (secret) {
      try {
        const parsed = JSON.parse(secret) as { username?: string; password?: string };
        if (parsed.username !== undefined && parsed.password !== undefined) {
          credentials = { username: parsed.username, password: parsed.password };
        }
      } catch {
        // Non-JSON secret material (e.g. a bare device path credential): nothing structured to forward.
      }
    }
  }

  try {
    await deps.pm.setPublisherBinding(publisherId, { address: input.address, ...(credentials ? { credentials } : {}) });
  } catch (error) {
    deps.logger?.warn('binding push to pipeline-manager failed', {
      roleId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export interface PhysicalInputPatch {
  address?: string | undefined;
  /** Plaintext credential material from the admin form (PF-17) — only the returned secret-store ref is ever persisted (INV-PI-2). */
  credentialRef?: string | null | undefined;
  transport?: 'tcp' | 'udp' | null | undefined;
}

/** `updatePhysicalInput` (AD-2 camera IP edits write this row, once — INV-PI-2, B-46's duplicate copies). Admin-only. */
export async function updatePhysicalInput(deps: BindingsDeps, inputId: string, patch: PhysicalInputPatch, actor: AuthContext): Promise<PhysicalInput> {
  if (actor.role !== 'admin') {
    throw new ProblemError(403, 'not-authorized', 'Only an admin may edit a physical input');
  }

  const current = deps.db.select().from(physicalInputs).where(eq(physicalInputs.id, inputId)).get();
  if (!current) {
    throw new ProblemError(404, 'not-found', 'Unknown physical input');
  }

  const now = deps.clock.now();
  const nowIso = now.toISOString();
  const nextAddress = patch.address ?? current.address;
  const nextCredentialRef =
    patch.credentialRef === undefined ? current.credentialRef : patch.credentialRef === null ? null : deps.secrets.put(patch.credentialRef);
  const nextTransport = patch.transport === undefined ? current.transport : patch.transport;

  deps.db.transaction((tx) => {
    tx.update(physicalInputs)
      .set({ address: nextAddress, credentialRef: nextCredentialRef, transport: nextTransport, updatedAt: nowIso, updatedBy: actor.userId })
      .where(eq(physicalInputs.id, inputId))
      .run();
    // INV-AU-3: the audit trail carries the secret-store ref, never the plaintext credential material.
    tx.insert(auditLogEntries)
      .values({
        id: deps.ids.next(now),
        at: nowIso,
        actorUserId: actor.userId,
        actorKind: 'user',
        entityType: 'PhysicalInput',
        entityId: inputId,
        action: 'config-change',
        before: { address: current.address, credentialRef: current.credentialRef, transport: current.transport },
        after: { address: nextAddress, credentialRef: nextCredentialRef, transport: nextTransport },
      })
      .run();
  });

  const updated = deps.db.select().from(physicalInputs).where(eq(physicalInputs.id, inputId)).get()!;

  // HL-09: every role currently bound to this input re-probes and A gets the resolved binding pushed again.
  const boundRoles = deps.db
    .select()
    .from(sourceBindings)
    .where(and(eq(sourceBindings.physicalInputId, inputId), eq(sourceBindings.enabled, true)))
    .all();
  for (const binding of boundRoles) {
    const roleId = binding.roleId as SourceRoleId;
    await pushBindingToPm(deps, roleId, updated);
    deps.sources.reprobe(roleId, true, inputId);
  }

  return toPhysicalInputPayload(updated);
}

export interface SourceBindingPatch {
  physicalInputId: string | null;
  enabled: boolean;
}

/** `updateSourceBinding` (HL-09 `cmd.admin.set_binding` — a provisioning act). Admin-only; `mic-room` stays permanently unbound (INV-SR-2). */
export async function updateSourceBinding(deps: BindingsDeps, roleId: string, patch: SourceBindingPatch, actor: AuthContext): Promise<SourceBinding> {
  if (actor.role !== 'admin') {
    throw new ProblemError(403, 'not-authorized', 'Only an admin may change a source binding');
  }
  if (roleId === 'mic-room') {
    throw new ProblemError(422, 'config.invalid', 'mic-room cannot be bound in V1 (INV-SR-2)');
  }

  const current = deps.db.select().from(sourceBindings).where(eq(sourceBindings.roleId, roleId)).get();
  if (!current) {
    throw new ProblemError(422, 'config.invalid', 'Unknown source role', { meta: { roleId } });
  }

  let input: typeof physicalInputs.$inferSelect | undefined;
  if (patch.physicalInputId !== null) {
    input = deps.db.select().from(physicalInputs).where(eq(physicalInputs.id, patch.physicalInputId)).get();
    if (!input) {
      throw new ProblemError(422, 'config.invalid', 'Unknown physical input', { meta: { inputId: patch.physicalInputId } });
    }
    const takenBy = deps.db
      .select({ roleId: sourceBindings.roleId })
      .from(sourceBindings)
      .where(and(eq(sourceBindings.physicalInputId, patch.physicalInputId), ne(sourceBindings.roleId, roleId)))
      .get();
    if (takenBy) {
      throw new ProblemError(409, 'conflict', 'This physical input is already bound to another role', { meta: { roleId: takenBy.roleId } });
    }
  }

  const now = deps.clock.now();
  const nowIso = now.toISOString();

  deps.db.transaction((tx) => {
    tx.update(sourceBindings)
      .set({ physicalInputId: patch.physicalInputId, enabled: patch.enabled, updatedAt: nowIso, updatedBy: actor.userId })
      .where(eq(sourceBindings.roleId, roleId))
      .run();
    tx.insert(auditLogEntries)
      .values({
        id: deps.ids.next(now),
        at: nowIso,
        actorUserId: actor.userId,
        actorKind: 'user',
        entityType: 'SourceBinding',
        entityId: roleId,
        action: 'config-change',
        before: { physicalInputId: current.physicalInputId, enabled: current.enabled },
        after: { physicalInputId: patch.physicalInputId, enabled: patch.enabled },
      })
      .run();
  });

  const bound = patch.enabled && patch.physicalInputId !== null;
  if (bound && input) {
    await pushBindingToPm(deps, roleId as SourceRoleId, input);
  }
  deps.sources.reprobe(roleId as SourceRoleId, bound, bound ? patch.physicalInputId : null);

  const updated = deps.db.select().from(sourceBindings).where(eq(sourceBindings.roleId, roleId)).get()!;
  return toSourceBindingPayload(updated);
}
