import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { QuizConfig } from '../config.js';
import type { QuizDb } from '../db/client.js';
import type { Clock } from '../lib/clock.js';
import { participants, participantSessions, students } from '../db/schema.js';

export const PARTICIPANT_COOKIE_NAME = 'eduscope_participant';
const PARTICIPANT_COOKIE_PATH = '/api/student/v1';
const TOKEN_BYTES = 32;

export interface ParticipantPrincipal {
  participantId: string;
  studentId: string;
  studentIdNumber: string;
  fullName: string;
  quizSessionId: string;
}

/** Opaque participant session token; only its SHA-256 hash is ever persisted. */
export function generateParticipantToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashParticipantToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Sets the contracted `eduscope_participant` cookie exactly (quiz-app.yaml `participantSession`). */
export function issueParticipantCookie(reply: FastifyReply, config: QuizConfig, token: string): void {
  reply.setCookie(PARTICIPANT_COOKIE_NAME, token, {
    secure: true,
    httpOnly: true,
    sameSite: 'lax',
    path: PARTICIPANT_COOKIE_PATH,
    maxAge: config.participantSessionTtlSec,
  });
}

/**
 * Reads and validates the participant cookie against its unexpired session
 * row. Purely a SELECT — never touches `last_seen_at` or any other row, so
 * callers on the read-only `resolveJoinCode` path stay write-free (INV-QP-1).
 * An absent, unknown, expired, or tampered cookie resolves to `undefined`
 * (anonymous); rejecting it outright is a later student WS/answer concern.
 */
export async function resolveParticipantCookie(
  request: FastifyRequest,
  db: QuizDb,
  clock: Clock,
): Promise<ParticipantPrincipal | undefined> {
  const token = request.cookies[PARTICIPANT_COOKIE_NAME];
  if (!token) return undefined;

  const tokenHash = hashParticipantToken(token);
  const rows = await db
    .select({
      participantId: participants.id,
      quizSessionId: participants.quizSessionId,
      studentId: students.id,
      studentIdNumber: students.studentIdNumber,
      fullName: students.fullName,
      expiresAt: participantSessions.expiresAt,
    })
    .from(participantSessions)
    .innerJoin(participants, eq(participants.id, participantSessions.participantId))
    .innerJoin(students, eq(students.id, participantSessions.studentId))
    .where(eq(participantSessions.tokenHash, tokenHash));

  const row = rows[0];
  if (!row || row.expiresAt.getTime() <= clock.now().getTime()) return undefined;

  return {
    participantId: row.participantId,
    studentId: row.studentId,
    studentIdNumber: row.studentIdNumber,
    fullName: row.fullName,
    quizSessionId: row.quizSessionId,
  };
}
