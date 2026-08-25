import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type WebSocket from 'ws';
import { zStudentEventEnvelope, type StudentServerEvent } from '@eduscope/shared';
import type { QuizDb } from '../db/client.js';
import { answers, participants, publications } from '../db/schema.js';
import type { Clock } from '../lib/clock.js';
import type { SessionSerial } from '../lib/session-serial.js';
import type { DomainNotifier } from '../device/publication-routes.js';
import type { DeviceStreamHub } from '../device/stream.js';
import type { ParticipantPrincipal } from './cookies.js';
import { resolveParticipantCookie } from './cookies.js';
import { buildSnapshot } from './snapshot.js';
import { serializeQuestion, serializeResult, serializeSessionTerminal, toCurrentPublicationRow } from './serializers.js';

declare module 'fastify' {
  interface FastifyRequest {
    studentStreamPrincipal?: ParticipantPrincipal;
  }
}

export interface StudentStreamLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

export interface StudentStreamHubDeps {
  db: QuizDb;
  clock: Clock;
  sessionSerial: SessionSerial;
  logger?: StudentStreamLogger;
  /** D-07: connect/disconnect changes the device stream's live online count. */
  deviceStreamHub?: DeviceStreamHub;
}

interface StudentConnection {
  socket: WebSocket;
  participantId: string;
  studentId: string;
  studentIdNumber: string;
  quizSessionId: string;
  seq: number;
  writeQueue: Promise<void>;
}

/**
 * events.md §5 fan-out: one socket per participant, snapshot-then-live-delta
 * ordering enforced by re-entering the same per-session `SessionSerial` key
 * D-02..D-05 already mutate under, so a connect can never straddle a
 * publish/close it should have seen either in its snapshot or its first
 * live delta, never neither (CG-22).
 */
export class StudentStreamHub {
  readonly #deps: StudentStreamHubDeps;
  readonly #connections = new Map<string, StudentConnection>();

  constructor(deps: StudentStreamHubDeps) {
    this.#deps = deps;
  }

  /** Wires the post-commit notifications D-02..D-05 already emit; `participant.joined`/`answer.accepted` carry no student-facing frame (events.md §5, D-06 step 7). */
  subscribeTo(domainEvents: DomainNotifier): void {
    domainEvents.on('publication.opened', (payload) => this.#onPublicationOpened(payload.quizSessionId, payload.publicationId!));
    domainEvents.on('publication.closed', (payload) => this.#onPublicationClosed(payload.quizSessionId, payload.publicationId!));
    domainEvents.on('session.closed', (payload) => this.#onSessionClosed(payload.quizSessionId));
  }

  async attach(socket: WebSocket, principal: ParticipantPrincipal): Promise<void> {
    await this.#deps.sessionSerial.run(principal.quizSessionId, async () => {
      const snapshot = await buildSnapshot(this.#deps.db, principal);

      const conn: StudentConnection = {
        socket,
        participantId: principal.participantId,
        studentId: principal.studentId,
        studentIdNumber: principal.studentIdNumber,
        quizSessionId: principal.quizSessionId,
        seq: 0,
        writeQueue: Promise.resolve(),
      };

      // Registering the new connection before closing any prior one means a
      // same-tick 'close' emission from the old socket already sees the new
      // entry in the registry and never marks it offline (INV: reconnect
      // replaces the old socket and snapshot wholesale).
      const existing = this.#connections.get(principal.participantId);
      this.#connections.set(principal.participantId, conn);
      if (existing) {
        existing.socket.close(4000, 'superseded by a new connection');
      }

      for (const event of snapshot) {
        this.#deliverTo(conn, event);
      }

      await this.#deps.db
        .update(participants)
        .set({ connectionState: 'online', lastSeenAt: this.#deps.clock.now() })
        .where(eq(participants.id, principal.participantId));
      this.#deps.deviceStreamHub?.markParticipantCounts(principal.quizSessionId);

      socket.on('message', () => {
        // Server->student only (events.md §5 "Direction"); any inbound frame is a protocol violation.
        socket.close(1008, 'student connections do not send frames');
      });
      socket.on('close', () => this.#detach(conn));
      socket.on('error', () => this.#detach(conn));
    });
  }

  #detach(conn: StudentConnection): void {
    if (this.#connections.get(conn.participantId) !== conn) return;
    this.#connections.delete(conn.participantId);
    void this.#deps.sessionSerial.run(conn.quizSessionId, async () => {
      await this.#deps.db
        .update(participants)
        .set({ connectionState: 'offline', lastSeenAt: this.#deps.clock.now() })
        .where(eq(participants.id, conn.participantId));
      this.#deps.deviceStreamHub?.markParticipantCounts(conn.quizSessionId);
    });
  }

  #connectionsFor(quizSessionId: string): StudentConnection[] {
    return [...this.#connections.values()].filter((conn) => conn.quizSessionId === quizSessionId);
  }

  #onPublicationOpened(quizSessionId: string, publicationId: string): void {
    void this.#deps.sessionSerial.run(quizSessionId, async () => {
      const conns = this.#connectionsFor(quizSessionId);
      if (conns.length === 0) return;

      const [publication] = await this.#deps.db.select().from(publications).where(eq(publications.id, publicationId));
      if (!publication) return;
      const row = toCurrentPublicationRow(publication);

      for (const conn of conns) {
        this.#deliverTo(conn, { event: 'quiz.question', payload: serializeQuestion(row, null) });
      }
    });
  }

  #onPublicationClosed(quizSessionId: string, publicationId: string): void {
    void this.#deps.sessionSerial.run(quizSessionId, async () => {
      const conns = this.#connectionsFor(quizSessionId);
      if (conns.length === 0) return;

      const [publication] = await this.#deps.db.select().from(publications).where(eq(publications.id, publicationId));
      if (!publication) return;
      const row = toCurrentPublicationRow(publication);

      for (const conn of conns) {
        const [ownAnswer] = await this.#deps.db
          .select()
          .from(answers)
          .where(and(eq(answers.publicationId, publicationId), eq(answers.studentId, conn.studentId)));

        this.#deliverTo(conn, {
          event: 'quiz.question',
          payload: serializeQuestion(row, ownAnswer?.selectedOptionId ?? null),
        });
        const result = await serializeResult(this.#deps.db, quizSessionId, conn.studentIdNumber, row, ownAnswer);
        this.#deliverTo(conn, { event: 'quiz.result', payload: result });
      }
    });
  }

  #onSessionClosed(quizSessionId: string): void {
    void this.#deps.sessionSerial.run(quizSessionId, async () => {
      const conns = this.#connectionsFor(quizSessionId);
      for (const conn of conns) {
        const payload = await serializeSessionTerminal(this.#deps.db, quizSessionId, conn.studentIdNumber);
        this.#deliverTo(conn, { event: 'quiz.session', payload });
      }
    });
  }

  #deliverTo(conn: StudentConnection, event: StudentServerEvent): void {
    const candidate = { ...event, at: this.#deps.clock.now().toISOString(), seq: conn.seq };
    const parsed = zStudentEventEnvelope.safeParse(candidate);
    if (!parsed.success) {
      this.#deps.logger?.warn('dropped invalid outgoing student event', {
        participantId: conn.participantId,
        quizSessionId: conn.quizSessionId,
        event: event.event,
      });
      this.#connections.delete(conn.participantId);
      conn.socket.close(1011, 'internal error');
      return;
    }

    conn.seq += 1;
    const data = JSON.stringify(parsed.data);
    conn.writeQueue = conn.writeQueue.then(
      () =>
        new Promise<void>((resolve) => {
          if (conn.socket.readyState !== conn.socket.OPEN) {
            resolve();
            return;
          }
          conn.socket.send(data, () => resolve());
        }),
    );
  }
}

/**
 * Not a `quiz-app.yaml` operationId (a raw upgrade, like the device sync
 * stream), so there is no closed Problem catalog to answer with — an
 * unauthenticated upgrade just fails the HTTP handshake outright. Mirrors
 * `panel-hub.ts`'s `wsAuthGuard`: a `@fastify/websocket` route must *throw*
 * to deny the upgrade — calling `reply.send()` directly from a websocket
 * route's preHandler leaves the handshake hanging instead of failing it.
 */
class StudentStreamAuthError extends Error {
  readonly statusCode = 401;
}

/** Registers the cookie-authenticated `GET /api/student/v1/stream` upgrade (events.md §5). */
export function registerStudentStreamRoutes(app: FastifyInstance, hub: StudentStreamHub): void {
  app.get(
    '/api/student/v1/stream',
    {
      websocket: true,
      preHandler: async (request: FastifyRequest) => {
        const principal = await resolveParticipantCookie(request, app.db, app.clock);
        if (!principal) {
          throw new StudentStreamAuthError('Missing or invalid participant cookie');
        }
        request.studentStreamPrincipal = principal;
      },
    },
    (socket, request) => {
      void hub.attach(socket, request.studentStreamPrincipal!);
    },
  );
}
