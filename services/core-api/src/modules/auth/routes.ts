import type { FastifyInstance } from 'fastify';
import { zChangePasswordRequest, zLoginRequest, zRefreshRequest } from '@eduscope/shared';
import { parseBody } from '../../contracts/validate.js';
import { requireAuth } from './guard.js';
import type { AuthService } from './service.js';

/** Registers the five auth operationIds (openapi.yaml tag `auth`). */
export function registerAuthRoutes(app: FastifyInstance, authService: AuthService): void {
  app.post('/api/v1/auth/login', { config: { operationId: 'login' } }, async (request, reply) => {
    const body = parseBody(zLoginRequest, request.body);
    const result = await authService.login(body);
    reply.code(200).send(result);
  });

  app.post('/api/v1/auth/refresh', { config: { operationId: 'refreshToken' } }, async (request, reply) => {
    const body = parseBody(zRefreshRequest, request.body);
    const result = await authService.refresh(body.refreshToken);
    reply.code(200).send(result);
  });

  app.post(
    '/api/v1/auth/logout',
    { config: { operationId: 'logout' }, preHandler: requireAuth(authService, 'logout') },
    async (request, reply) => {
      await authService.logout(request.authContext!.authSessionId);
      reply.code(204).send();
    },
  );

  app.get(
    '/api/v1/auth/me',
    { config: { operationId: 'getMe' }, preHandler: requireAuth(authService, 'getMe') },
    async (request, reply) => {
      const user = await authService.getMe(request.authContext!.userId);
      reply.code(200).send(user);
    },
  );

  app.post(
    '/api/v1/auth/change-password',
    { config: { operationId: 'changePassword' }, preHandler: requireAuth(authService, 'changePassword') },
    async (request, reply) => {
      const body = parseBody(zChangePasswordRequest, request.body);
      await authService.changePassword(request.authContext!.userId, body.currentPassword, body.newPassword);
      reply.code(204).send();
    },
  );
}
