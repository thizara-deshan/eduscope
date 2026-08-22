import { and, eq, inArray, isNull } from 'drizzle-orm';
import { ProblemError } from '../../contracts/problem.js';
import type { DrizzleDb } from '../../db/client.js';
import { auditLogEntries, authSessions, lectureSessions } from '../../db/schema.js';
import type { Clock } from '../../lib/clock.js';
import type { IdGenerator } from '../../lib/ids.js';
import type { AuthContext } from '../auth/service.js';

/** state-machines.md §1: the non-terminal vocabulary a "current session" read is scoped to. */
const NON_TERMINAL_STATES = ['starting', 'recording', 'paused', 'stopping', 'finalizing'] as const;

export interface TakeoverDeps {
  db: DrizzleDb;
  clock: Clock;
  ids: IdGenerator;
}

export interface TakeoverResult {
  session: typeof lectureSessions.$inferSelect;
}

/**
 * R-21 `cmd.recording.takeover` (G-ADMIN, LP-6). `ownerUserId` — and every
 * segment/recording row keyed off it — is left untouched; only `takeoverBy`/
 * `takeoverAt` change (INV-LS-2 grants the admin control without rewriting
 * whose lecture this is). Audited, and the displaced owner's panel authority
 * ends immediately (their kiosk `AuthSession`s are revoked the same way
 * `auth.session-revoked{reason:takeover}` is worded elsewhere, CG-14).
 */
export function takeoverRecording(deps: TakeoverDeps, actor: AuthContext): TakeoverResult {
  if (actor.role !== 'admin') {
    throw new ProblemError(403, 'not-authorized', 'Only an admin may take over a recording');
  }

  const { db, clock, ids } = deps;
  const now = clock.now();
  const nowIso = now.toISOString();

  let result!: TakeoverResult;
  db.transaction((tx) => {
    const session = tx.select().from(lectureSessions).where(inArray(lectureSessions.state, NON_TERMINAL_STATES)).get();
    if (!session) {
      throw new ProblemError(409, 'session.not-active', 'No recording is active');
    }

    tx.update(lectureSessions).set({ takeoverBy: actor.userId, takeoverAt: nowIso }).where(eq(lectureSessions.id, session.id)).run();

    tx.insert(auditLogEntries)
      .values({
        id: ids.next(now),
        at: nowIso,
        actorUserId: actor.userId,
        actorKind: 'user',
        entityType: 'LectureSession',
        entityId: session.id,
        action: 'takeover',
        sessionId: session.id,
        before: { ownerUserId: session.ownerUserId, takeoverBy: session.takeoverBy },
        after: { ownerUserId: session.ownerUserId, takeoverBy: actor.userId },
      })
      .run();

    tx.update(authSessions)
      .set({ revokedAt: nowIso, revokedReason: 'takeover' })
      .where(and(eq(authSessions.userId, session.ownerUserId), eq(authSessions.client, 'panel'), isNull(authSessions.revokedAt)))
      .run();

    const updated = tx.select().from(lectureSessions).where(eq(lectureSessions.id, session.id)).get()!;
    result = { session: updated };
  });
  return result;
}
