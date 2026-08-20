import type { FastifyInstance } from 'fastify';
import { zQuestionCreate, zQuestionUpdate, zQuestionState } from '@eduscope/shared';
import { z } from 'zod';
import { requireAuth } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import { parseBody } from '../../contracts/validate.js';
import { listQuestions } from './question-sets.js';
import { createQuestion, discardQuestion, editQuestion, type QuestionsDeps } from './questions.js';

const zListQuestionsQuery = z.object({ sessionId: z.string().min(1), state: zQuestionState.optional() });

/** Registers this task's operationIds (openapi.yaml tag `ai`): `listQuestions`, `createQuestion`, `editQuestion`, `discardQuestion`. */
export function registerQuestionRoutes(app: FastifyInstance, authService: AuthService, deps: QuestionsDeps): void {
  app.get(
    '/api/v1/ai/questions',
    { config: { operationId: 'listQuestions' }, preHandler: requireAuth(authService, 'listQuestions') },
    async (request, reply) => {
      const { sessionId, state } = parseBody(zListQuestionsQuery, request.query);
      reply.code(200).send({ items: listQuestions(deps.db, sessionId, state) });
    },
  );

  app.post(
    '/api/v1/ai/questions',
    { config: { operationId: 'createQuestion' }, preHandler: requireAuth(authService, 'createQuestion') },
    async (request, reply) => {
      const body = parseBody(zQuestionCreate, request.body);
      const result = createQuestion(deps, request.authContext!, body);
      reply.code(202).send(result);
    },
  );

  app.patch(
    '/api/v1/ai/questions/:questionId',
    { config: { operationId: 'editQuestion' }, preHandler: requireAuth(authService, 'editQuestion') },
    async (request, reply) => {
      const { questionId } = request.params as { questionId: string };
      const body = parseBody(zQuestionUpdate, request.body);
      const result = editQuestion(deps, request.authContext!, questionId, body);
      reply.code(202).send(result);
    },
  );

  app.post(
    '/api/v1/ai/questions/:questionId/discard',
    { config: { operationId: 'discardQuestion' }, preHandler: requireAuth(authService, 'discardQuestion') },
    async (request, reply) => {
      const { questionId } = request.params as { questionId: string };
      const result = discardQuestion(deps, request.authContext!, questionId);
      reply.code(202).send(result);
    },
  );
}
