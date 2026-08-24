import { randomInt } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { zQuizSessionCreateRequest, type QuizSessionCreateResponse } from '@eduscope/shared';
import { publications, quizSessions } from '../db/schema.js';
import { ProblemError, parseBody } from '../contracts/problem.js';
import { authenticateDevice, type DevicePrincipal } from './auth.js';

/** Injected per the repository convention alongside `Clock`/`IdGenerator`; production is cryptographically random. */
export interface JoinCodeGenerator {
  next(): string;
}

const JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const JOIN_CODE_LENGTH = 6;
const MAX_JOIN_CODE_ATTEMPTS = 16;
const JOIN_CODE_UNIQUE_CONSTRAINT = 'one_open_quiz_session_per_join_code';

export class RandomJoinCodeGenerator implements JoinCodeGenerator {
  next(): string {
    let code = '';
    for (let index = 0; index < JOIN_CODE_LENGTH; index += 1) {
      code += JOIN_CODE_ALPHABET[randomInt(JOIN_CODE_ALPHABET.length)];
    }
    return code;
  }
}

interface UniqueViolation {
  code: string;
  constraint_name?: string;
}

function asUniqueViolation(value: unknown): UniqueViolation | undefined {
  if (typeof value !== 'object' || value === null || !('code' in value)) return undefined;
  return (value as { code: unknown }).code === '23505' ? (value as UniqueViolation) : undefined;
}

/** drizzle-orm's postgres-js driver wraps the raw `PostgresError` in a `DrizzleQueryError`, exposed via `.cause`. */
function unwrapUniqueViolation(error: unknown): UniqueViolation | undefined {
  return (
    asUniqueViolation(error) ??
    asUniqueViolation(error instanceof Error ? error.cause : undefined)
  );
}

function toCreateResponse(row: {
  id: string;
  lectureSessionId: string;
  state: string;
  joinCode: string;
  joinUrl: string;
  openedAt: Date;
}): QuizSessionCreateResponse {
  return {
    id: row.id,
    lectureSessionId: row.lectureSessionId,
    state: row.state as 'open' | 'closed',
    joinCode: row.joinCode,
    joinUrl: row.joinUrl,
    openedAt: row.openedAt.toISOString(),
  };
}

function lectureCollisionConflict(): ProblemError {
  return new ProblemError(409, 'conflict', 'Lecture already has an open quiz session on another device');
}

/** Registers D-owned `quizSyncCreateSession` and `quizSyncCloseSession` (openapi.yaml tag: quiz-sync). */
export function registerDeviceSessionRoutes(app: FastifyInstance): void {
  app.post(
    '/device/v1/quiz-sessions',
    { config: { operationId: 'quizSyncCreateSession' }, preHandler: authenticateDevice },
    async (request, reply) => {
      const principal = request.deviceContext as DevicePrincipal;
      const body = parseBody(zQuizSessionCreateRequest, request.body);

      if (body.deviceId !== principal.deviceId) {
        throw new ProblemError(401, 'not-authorized', 'Device authentication failed');
      }

      const response = await app.sessionSerial.run(body.lectureSessionId, () =>
        app.db.transaction(async (tx) => {
          const existing = await tx
            .select()
            .from(quizSessions)
            .where(and(eq(quizSessions.lectureSessionId, body.lectureSessionId), eq(quizSessions.state, 'open')))
            .for('update');

          if (existing.length > 0) {
            const row = existing[0]!;
            if (row.deviceId !== principal.deviceId) {
              throw lectureCollisionConflict();
            }
            return toCreateResponse(row);
          }

          const now = app.clock.now();
          const joinUrl = (joinCode: string): string => new URL(`/j/${joinCode}`, app.config.publicOrigin).toString();

          for (let attempt = 0; attempt < MAX_JOIN_CODE_ATTEMPTS; attempt += 1) {
            const joinCode = app.joinCodeGenerator.next();
            try {
              // A failed INSERT poisons the rest of the outer transaction in
              // PostgreSQL unless it runs under its own SAVEPOINT — nested
              // `tx.transaction()` is drizzle's savepoint boundary, letting a
              // join-code collision retry (or the re-select fallback below)
              // keep using `tx` afterward.
              const inserted = await tx.transaction(async (tx2) => {
                const [row] = await tx2
                  .insert(quizSessions)
                  .values({
                    id: app.ids.next(now),
                    lectureSessionId: body.lectureSessionId,
                    deviceId: principal.deviceId,
                    hallDisplayName: body.hallDisplayName,
                    joinCode,
                    joinUrl: joinUrl(joinCode),
                    state: 'open',
                    openedAt: now,
                  })
                  .returning();
                return row!;
              });
              return toCreateResponse(inserted);
            } catch (error) {
              const violation = unwrapUniqueViolation(error);
              if (!violation) {
                throw error;
              }
              if (violation.constraint_name === JOIN_CODE_UNIQUE_CONSTRAINT) {
                continue;
              }
              const reselected = await tx
                .select()
                .from(quizSessions)
                .where(and(eq(quizSessions.lectureSessionId, body.lectureSessionId), eq(quizSessions.state, 'open')))
                .for('update');
              const row = reselected[0];
              if (row && row.deviceId === principal.deviceId) {
                return toCreateResponse(row);
              }
              throw lectureCollisionConflict();
            }
          }
          throw new ProblemError(409, 'conflict', 'Unable to allocate a unique join code');
        }),
      );

      reply.code(201).send(response);
    },
  );

  app.post(
    '/device/v1/quiz-sessions/:quizSessionId/close',
    { config: { operationId: 'quizSyncCloseSession' }, preHandler: authenticateDevice },
    async (request, reply) => {
      const principal = request.deviceContext as DevicePrincipal;
      const { quizSessionId } = request.params as { quizSessionId: string };

      await app.sessionSerial.run(quizSessionId, () =>
        app.db.transaction(async (tx) => {
          const rows = await tx
            .select()
            .from(quizSessions)
            .where(
              and(
                eq(quizSessions.id, quizSessionId),
                eq(quizSessions.deviceId, principal.deviceId),
                eq(quizSessions.state, 'open'),
              ),
            )
            .for('update');
          const session = rows[0];
          if (!session) {
            return;
          }

          const now = app.clock.now();

          await tx
            .update(publications)
            .set({ state: 'closed', closedAt: now, closeReason: 'session-ended' })
            .where(and(eq(publications.quizSessionId, quizSessionId), eq(publications.state, 'open')));

          await tx
            .update(quizSessions)
            .set({ state: 'closed', closedAt: now })
            .where(eq(quizSessions.id, quizSessionId));
        }),
      );

      reply.code(204).send();
    },
  );
}
