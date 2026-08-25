import { EventEmitter } from 'node:events';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { zPublicationCloseRequest, zPublicationPush } from '@eduscope/shared';
import { publications, quizSessions, type StoredQuizOption } from '../db/schema.js';
import { ProblemError, parseBody } from '../contracts/problem.js';
import { authenticateDevice, type DevicePrincipal } from './auth.js';

export type QuizDomainEventName =
  | 'publication.opened'
  | 'publication.closed'
  | 'session.closed'
  | 'participant.joined'
  | 'answer.accepted';

export interface QuizDomainEventPayload {
  quizSessionId: string;
  publicationId?: string;
  participantId?: string;
  answerId?: string;
  seq?: number;
}

/**
 * Post-commit, ids-only fan-out seam. D-06/D-07 subscribe to drive student
 * and device realtime notifications off the authoritative DB transitions
 * this task and D-02's close already commit.
 */
export interface DomainNotifier {
  emit(event: QuizDomainEventName, payload: QuizDomainEventPayload): void;
  on(event: QuizDomainEventName, listener: (payload: QuizDomainEventPayload) => void): void;
}

export class EventEmitterDomainNotifier implements DomainNotifier {
  readonly #emitter = new EventEmitter();

  emit(event: QuizDomainEventName, payload: QuizDomainEventPayload): void {
    this.#emitter.emit(event, payload);
  }

  on(event: QuizDomainEventName, listener: (payload: QuizDomainEventPayload) => void): void {
    this.#emitter.on(event, listener);
  }
}

function sessionConflict(): ProblemError {
  return new ProblemError(409, 'conflict', 'Quiz session is not open for this device');
}

/** Registers D-owned `quizSyncPublish` and `quizSyncClosePublication` (openapi.yaml tag: quiz-sync). */
export function registerDevicePublicationRoutes(app: FastifyInstance): void {
  app.post(
    '/device/v1/publications',
    { config: { operationId: 'quizSyncPublish' }, preHandler: authenticateDevice },
    async (request, reply) => {
      const principal = request.deviceContext as DevicePrincipal;
      const body = parseBody(zPublicationPush, request.body);

      if (!body.options.some((option) => option.id === body.correctOptionId)) {
        throw new ProblemError(422, 'validation.invalid', 'correctOptionId must be one of options');
      }

      const closedPublicationId = await app.sessionSerial.run(body.quizSessionId, () =>
        app.db.transaction(async (tx) => {
          const [session] = await tx
            .select()
            .from(quizSessions)
            .where(
              and(
                eq(quizSessions.id, body.quizSessionId),
                eq(quizSessions.deviceId, principal.deviceId),
                eq(quizSessions.state, 'open'),
              ),
            )
            .for('update');
          if (!session) {
            throw sessionConflict();
          }

          const [existing] = await tx
            .select()
            .from(publications)
            .where(eq(publications.id, body.publicationId))
            .for('update');
          if (existing && existing.quizSessionId !== body.quizSessionId) {
            throw sessionConflict();
          }

          let closedPublicationId: string | undefined;
          const [currentOpen] = await tx
            .select()
            .from(publications)
            .where(and(eq(publications.quizSessionId, body.quizSessionId), eq(publications.state, 'open')))
            .for('update');
          if (currentOpen && currentOpen.id !== body.publicationId) {
            await tx
              .update(publications)
              .set({ state: 'closed', closedAt: new Date(body.publishedAt), closeReason: 'next-question' })
              .where(eq(publications.id, currentOpen.id));
            closedPublicationId = currentOpen.id;
          }

          const replicatedFields = {
            questionId: body.questionId,
            prompt: body.prompt,
            options: body.options as StoredQuizOption[],
            correctOptionId: body.correctOptionId,
          };

          if (existing) {
            await tx.update(publications).set(replicatedFields).where(eq(publications.id, existing.id));
          } else {
            await tx.insert(publications).values({
              id: body.publicationId,
              quizSessionId: body.quizSessionId,
              ...replicatedFields,
              state: 'open',
              publishedAt: new Date(body.publishedAt),
            });
          }

          return closedPublicationId;
        }),
      );

      if (closedPublicationId) {
        app.domainEvents.emit('publication.closed', { quizSessionId: body.quizSessionId, publicationId: closedPublicationId });
      }
      app.domainEvents.emit('publication.opened', { quizSessionId: body.quizSessionId, publicationId: body.publicationId });

      reply.code(201).send();
    },
  );

  app.post(
    '/device/v1/publications/:publicationId/close',
    { config: { operationId: 'quizSyncClosePublication' }, preHandler: authenticateDevice },
    async (request, reply) => {
      const principal = request.deviceContext as DevicePrincipal;
      const { publicationId } = request.params as { publicationId: string };
      const body = parseBody(zPublicationCloseRequest, request.body);

      if (body.publicationId !== publicationId) {
        throw new ProblemError(422, 'validation.invalid', 'path publicationId must equal body.publicationId');
      }

      const [owned] = await app.db
        .select({ quizSessionId: publications.quizSessionId })
        .from(publications)
        .innerJoin(quizSessions, eq(quizSessions.id, publications.quizSessionId))
        .where(and(eq(publications.id, publicationId), eq(quizSessions.deviceId, principal.deviceId)));

      if (!owned) {
        reply.code(204).send();
        return;
      }

      const quizSessionId = owned.quizSessionId;
      const closed = await app.sessionSerial.run(quizSessionId, () =>
        app.db.transaction(async (tx) => {
          const [row] = await tx
            .select()
            .from(publications)
            .where(and(eq(publications.id, publicationId), eq(publications.state, 'open')))
            .for('update');
          if (!row) {
            return false;
          }
          await tx
            .update(publications)
            .set({ state: 'closed', closedAt: new Date(body.closedAt), closeReason: body.closeReason })
            .where(eq(publications.id, publicationId));
          return true;
        }),
      );

      if (closed) {
        app.domainEvents.emit('publication.closed', { quizSessionId, publicationId });
      }

      reply.code(204).send();
    },
  );
}
