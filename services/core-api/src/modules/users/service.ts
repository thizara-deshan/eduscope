import type { PanelOperationId, User } from '@eduscope/shared';
import { and, asc, eq, gt, ne, or, sql } from 'drizzle-orm';
import { ProblemError } from '../../contracts/problem.js';
import type { DrizzleDb } from '../../db/client.js';
import { auditLogEntries, authSessions, users } from '../../db/schema.js';
import type { Clock } from '../../lib/clock.js';
import type { IdGenerator } from '../../lib/ids.js';
import { hashPassword } from '../auth/passwords.js';
import type { AuthContext } from '../auth/service.js';

/**
 * The full v1 operation set's server-enforced role/owner requirement
 * (design/core-api.md §7, B-43 KEEP). The 'admin' tier is derived directly
 * from openapi.yaml `x-required-role: admin`; 'owner-or-admin' operations are
 * cross-referenced against each owning module's `assertAuthOwner` or
 * ownership check (recording pause/resume/stop, channel enable/disable,
 * library reads, exports, audio control). Enforcement itself stays in each
 * operation's own handler — this map is the single source future audits diff
 * against, not a runtime gate.
 */
export type AuthorizationRequirement = 'public' | 'admin' | 'owner-or-admin' | 'any-authenticated';

export const OPERATION_AUTHORIZATION: Record<PanelOperationId, AuthorizationRequirement> = {
  login: 'public',
  refreshToken: 'public',
  logout: 'any-authenticated',
  getMe: 'any-authenticated',
  changePassword: 'any-authenticated',
  getRecordingState: 'any-authenticated',
  startRecording: 'any-authenticated',
  pauseRecording: 'owner-or-admin',
  resumeRecording: 'owner-or-admin',
  stopRecording: 'owner-or-admin',
  takeoverRecording: 'admin',
  listChannels: 'any-authenticated',
  updateChannelConfig: 'any-authenticated',
  enableChannel: 'owner-or-admin',
  disableChannel: 'owner-or-admin',
  listLayoutPresets: 'any-authenticated',
  listSourceRoles: 'any-authenticated',
  getSourcesStatus: 'any-authenticated',
  getSourcePreview: 'any-authenticated',
  listPhysicalInputs: 'admin',
  updatePhysicalInput: 'admin',
  listSourceBindings: 'admin',
  updateSourceBinding: 'admin',
  listAudioControls: 'any-authenticated',
  updateAudioControl: 'owner-or-admin',
  listRecordings: 'any-authenticated',
  getRecording: 'owner-or-admin',
  deleteRecording: 'admin',
  retryMergeRecording: 'admin',
  getRecordingMedia: 'owner-or-admin',
  listExportTargets: 'any-authenticated',
  createExport: 'owner-or-admin',
  getExport: 'owner-or-admin',
  cancelExport: 'owner-or-admin',
  listUploadJobs: 'admin',
  getUploadJob: 'admin',
  requeueUploadJob: 'admin',
  getProvisioning: 'any-authenticated',
  getDeviceHealth: 'any-authenticated',
  listAlerts: 'any-authenticated',
  acknowledgeAlert: 'any-authenticated',
  powerOffDevice: 'any-authenticated',
  getStorageOverview: 'any-authenticated',
  registerStorageVolume: 'admin',
  formatStorageVolume: 'admin',
  listNetworkConfigs: 'admin',
  updateNetworkConfig: 'admin',
  getEncoderSettings: 'admin',
  updateEncoderSettings: 'admin',
  listStreamTargets: 'admin',
  createStreamTarget: 'admin',
  updateStreamTarget: 'admin',
  deleteStreamTarget: 'admin',
  getFirmwareState: 'admin',
  checkFirmware: 'admin',
  applyFirmware: 'admin',
  listUsers: 'admin',
  createUser: 'admin',
  updateUser: 'admin',
  deleteUser: 'admin',
  importUsers: 'admin',
  getAiCountdown: 'any-authenticated',
  setAiInterval: 'any-authenticated',
  generateNow: 'any-authenticated',
  listQuestionSets: 'any-authenticated',
  getQuestionSet: 'any-authenticated',
  listQuestions: 'any-authenticated',
  createQuestion: 'any-authenticated',
  editQuestion: 'any-authenticated',
  discardQuestion: 'any-authenticated',
  sendToProjector: 'any-authenticated',
  listPublications: 'any-authenticated',
  closePublication: 'any-authenticated',
  setProjector: 'any-authenticated',
  getQuizSession: 'any-authenticated',
  listPublicationResponses: 'any-authenticated',
  getLeaderboard: 'any-authenticated',
  queryLogs: 'admin',
  exportLogsCsv: 'admin',
};

export interface UsersServiceDeps {
  db: DrizzleDb;
  clock: Clock;
  ids: IdGenerator;
}

export interface ListUsersQuery {
  cursor?: string | undefined;
  limit: number;
  q?: string | undefined;
  role?: 'lecturer' | 'admin' | undefined;
}

export interface ListUsersResult {
  items: User[];
  nextCursor: string | null;
}

export interface CreateUserInput {
  username: string;
  displayName: string;
  role: 'lecturer' | 'admin';
  password: string;
}

export interface UpdateUserInput {
  displayName?: string | undefined;
  role?: 'lecturer' | 'admin' | undefined;
  disabled?: boolean | undefined;
  password?: string | undefined;
}

interface UserCursor {
  username: string;
  id: string;
}

function encodeUserCursor(cursor: UserCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeUserCursor(raw: string): UserCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw new ProblemError(422, 'validation.invalid', 'Invalid cursor');
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).username !== 'string' ||
    typeof (parsed as Record<string, unknown>).id !== 'string'
  ) {
    throw new ProblemError(422, 'validation.invalid', 'Invalid cursor');
  }
  return parsed as UserCursor;
}

/** Safe read view — `passwordHash` never leaves this module (INV-U-1). */
function toSafeUser(row: typeof users.$inferSelect): User {
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    source: row.source,
    mustResetPassword: row.mustResetPassword,
    disabled: row.disabled,
    lastLoginAt: row.lastLoginAt ?? null,
    createdAt: row.createdAt,
  };
}

/** `listUsers` (openapi.yaml, AD-6 directory): `(username, id)` keyset pagination plus `q`/`role` filters. Admin-only gate applied by the route. */
export function listUsers(db: DrizzleDb, query: ListUsersQuery): ListUsersResult {
  const conditions = [];

  if (query.role !== undefined) {
    conditions.push(eq(users.role, query.role));
  }
  if (query.q !== undefined && query.q.length > 0) {
    const needle = `%${query.q.toLowerCase()}%`;
    conditions.push(or(sql`lower(${users.username}) like ${needle}`, sql`lower(${users.displayName}) like ${needle}`));
  }
  if (query.cursor !== undefined) {
    const cursor = decodeUserCursor(query.cursor);
    conditions.push(or(gt(users.username, cursor.username), and(eq(users.username, cursor.username), gt(users.id, cursor.id))));
  }

  const rows = db
    .select()
    .from(users)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(users.username), asc(users.id))
    .limit(query.limit + 1)
    .all();

  const page = rows.slice(0, query.limit);
  const nextCursor =
    rows.length > query.limit ? encodeUserCursor({ username: page[page.length - 1]!.username, id: page[page.length - 1]!.id }) : null;

  return { items: page.map(toSafeUser), nextCursor };
}

/** INV-U-3/self-safety: an admin may never disable or delete their own account, regardless of how many other admins exist. */
function assertNotSelfAction(actor: AuthContext, targetUserId: string, willDisable: boolean): void {
  if (willDisable && actor.userId === targetUserId) {
    throw new ProblemError(409, 'conflict', 'An admin cannot disable or delete their own account');
  }
}

/** The device must always keep at least one enabled admin able to administer it. */
function assertLastEnabledAdminSurvives(
  db: DrizzleDb,
  target: { id: string; role: 'lecturer' | 'admin'; disabled: boolean },
  willBeEnabledAdmin: boolean,
): void {
  if (target.role !== 'admin' || target.disabled || willBeEnabledAdmin) return;

  const otherEnabledAdmins = db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, 'admin'), eq(users.disabled, false), ne(users.id, target.id)))
    .all();
  if (otherEnabledAdmins.length === 0) {
    throw new ProblemError(409, 'conflict', 'Cannot remove the last enabled admin');
  }
}

/** `createUser` (openapi.yaml, LP-2): always local-source, always forces reset on first login (INV-UI-2 applied uniformly, not just to imports). */
export async function createUser(deps: UsersServiceDeps, actor: AuthContext, input: CreateUserInput): Promise<User> {
  const existing = deps.db.select({ id: users.id }).from(users).where(eq(users.username, input.username)).get();
  if (existing) {
    throw new ProblemError(409, 'conflict', 'Username is already taken');
  }

  const now = deps.clock.now();
  const nowIso = now.toISOString();
  const id = deps.ids.next(now);
  const row = {
    id,
    username: input.username,
    displayName: input.displayName,
    role: input.role,
    source: 'local' as const,
    externalId: null,
    passwordHash: await hashPassword(input.password),
    mustResetPassword: true,
    disabled: false,
    lastLoginAt: null,
    createdAt: nowIso,
    createdBy: actor.userId,
    importBatchId: null,
  };

  deps.db.transaction((tx) => {
    tx.insert(users).values(row).run();
    tx.insert(auditLogEntries)
      .values({
        id: deps.ids.next(now),
        at: nowIso,
        actorUserId: actor.userId,
        actorKind: 'user',
        entityType: 'user',
        entityId: id,
        action: 'create',
        sessionId: null,
        before: null,
        after: { username: row.username, displayName: row.displayName, role: row.role },
        reason: null,
      })
      .run();
  });

  return toSafeUser(row);
}

/** `updateUser` (openapi.yaml, AD-6): edits, disables, or forces a reset. Guarded by the last-enabled-admin and self-action rules before any write. */
export async function updateUser(deps: UsersServiceDeps, actor: AuthContext, userId: string, patch: UpdateUserInput): Promise<User> {
  const row = deps.db.select().from(users).where(eq(users.id, userId)).get();
  if (!row) {
    throw new ProblemError(404, 'not-found', 'User not found');
  }

  const willDisable = patch.disabled === true;
  assertNotSelfAction(actor, userId, willDisable);

  const nextRole = patch.role ?? row.role;
  const nextDisabled = patch.disabled ?? row.disabled;
  assertLastEnabledAdminSurvives(deps.db, row, nextRole === 'admin' && !nextDisabled);

  const now = deps.clock.now();
  const nowIso = now.toISOString();
  const updated = {
    displayName: patch.displayName ?? row.displayName,
    role: nextRole,
    disabled: nextDisabled,
    mustResetPassword: patch.password !== undefined ? true : row.mustResetPassword,
    passwordHash: patch.password !== undefined ? await hashPassword(patch.password) : row.passwordHash,
  };

  deps.db.transaction((tx) => {
    tx.update(users).set(updated).where(eq(users.id, userId)).run();
    tx.insert(auditLogEntries)
      .values({
        id: deps.ids.next(now),
        at: nowIso,
        actorUserId: actor.userId,
        actorKind: 'user',
        entityType: 'user',
        entityId: userId,
        action: 'edit',
        sessionId: null,
        before: { displayName: row.displayName, role: row.role, disabled: row.disabled },
        after: { displayName: updated.displayName, role: updated.role, disabled: updated.disabled },
        reason: null,
      })
      .run();
    if (updated.disabled && !row.disabled) {
      tx.update(authSessions)
        .set({ revokedAt: nowIso, revokedReason: 'admin' })
        .where(and(eq(authSessions.userId, userId), sql`${authSessions.revokedAt} is null`))
        .run();
    }
  });

  return toSafeUser({ ...row, ...updated });
}

/**
 * `deleteUser` (openapi.yaml, INV-U-5): soft — sets `disabled = true` so
 * `Recording.ownerUserId` keeps a valid tombstone reference instead of an
 * orphaned foreign key. Idempotent against an already-tombstoned user.
 */
export function deleteUser(deps: UsersServiceDeps, actor: AuthContext, userId: string): void {
  const row = deps.db.select().from(users).where(eq(users.id, userId)).get();
  if (!row) {
    throw new ProblemError(404, 'not-found', 'User not found');
  }
  if (row.disabled) {
    return;
  }

  assertNotSelfAction(actor, userId, true);
  assertLastEnabledAdminSurvives(deps.db, row, false);

  const now = deps.clock.now();
  const nowIso = now.toISOString();

  deps.db.transaction((tx) => {
    tx.update(users).set({ disabled: true }).where(eq(users.id, userId)).run();
    tx.insert(auditLogEntries)
      .values({
        id: deps.ids.next(now),
        at: nowIso,
        actorUserId: actor.userId,
        actorKind: 'user',
        entityType: 'user',
        entityId: userId,
        action: 'delete',
        sessionId: null,
        before: { disabled: false },
        after: { disabled: true },
        reason: null,
      })
      .run();
    tx.update(authSessions)
      .set({ revokedAt: nowIso, revokedReason: 'admin' })
      .where(and(eq(authSessions.userId, userId), sql`${authSessions.revokedAt} is null`))
      .run();
  });
}
