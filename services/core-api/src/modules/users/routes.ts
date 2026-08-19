import { zUserCreate, zUserRole, zUserUpdate } from '@eduscope/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ProblemError } from '../../contracts/problem.js';
import { parseBody } from '../../contracts/validate.js';
import { requireAuth } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import { createUser, deleteUser, listUsers, updateUser, type UsersServiceDeps } from './service.js';

const DEFAULT_LIST_USERS_LIMIT = 50;

const zListUsersQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  q: z.string().max(128).optional(),
  role: zUserRole.optional(),
});

function assertAdmin(role: 'lecturer' | 'admin'): void {
  if (role !== 'admin') throw new ProblemError(403, 'not-authorized', 'Administrator role required');
}

/** Registers this task's operationIds (openapi.yaml tag `users`): `listUsers`, `createUser`, `updateUser`, `deleteUser`. All `x-required-role: admin`. */
export function registerUsersRoutes(app: FastifyInstance, authService: AuthService, deps: UsersServiceDeps): void {
  app.get(
    '/api/v1/users',
    { config: { operationId: 'listUsers' }, preHandler: requireAuth(authService, 'listUsers') },
    async (request, reply) => {
      assertAdmin(request.authContext!.role);
      const query = parseBody(zListUsersQuery, request.query);
      const result = listUsers(deps.db, {
        cursor: query.cursor,
        limit: query.limit ?? DEFAULT_LIST_USERS_LIMIT,
        q: query.q,
        role: query.role,
      });
      reply.code(200).send(result);
    },
  );

  app.post(
    '/api/v1/users',
    { config: { operationId: 'createUser' }, preHandler: requireAuth(authService, 'createUser') },
    async (request, reply) => {
      assertAdmin(request.authContext!.role);
      const body = parseBody(zUserCreate, request.body);
      const user = await createUser(deps, request.authContext!, body);
      reply.code(201).send(user);
    },
  );

  app.patch(
    '/api/v1/users/:userId',
    { config: { operationId: 'updateUser' }, preHandler: requireAuth(authService, 'updateUser') },
    async (request, reply) => {
      assertAdmin(request.authContext!.role);
      const { userId } = request.params as { userId: string };
      const patch = parseBody(zUserUpdate, request.body);
      const user = await updateUser(deps, request.authContext!, userId, patch);
      reply.code(200).send(user);
    },
  );

  app.delete(
    '/api/v1/users/:userId',
    { config: { operationId: 'deleteUser' }, preHandler: requireAuth(authService, 'deleteUser') },
    async (request, reply) => {
      assertAdmin(request.authContext!.role);
      const { userId } = request.params as { userId: string };
      deleteUser(deps, request.authContext!, userId);
      reply.code(204).send();
    },
  );
}
