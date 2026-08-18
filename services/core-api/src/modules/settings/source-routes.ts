import type { FastifyInstance } from 'fastify';
import { zPhysicalInputUpdate, zSourceBindingUpdate } from '@eduscope/shared';
import { requireAuth } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import { parseBody } from '../../contracts/validate.js';
import { physicalInputs, sourceBindings, sourceRoles } from '../../db/schema.js';
import { toPhysicalInputPayload, toSourceBindingPayload, updatePhysicalInput, updateSourceBinding, type BindingsDeps } from './bindings.js';

/** Registers this task's operationIds (openapi.yaml tag `sources`): `listSourceRoles`, `listPhysicalInputs`, `updatePhysicalInput`, `listSourceBindings`, `updateSourceBinding`. */
export function registerSourceSettingsRoutes(app: FastifyInstance, authService: AuthService, deps: BindingsDeps): void {
  app.get(
    '/api/v1/sources/roles',
    { config: { operationId: 'listSourceRoles' }, preHandler: requireAuth(authService, 'listSourceRoles') },
    async (_request, reply) => {
      reply.code(200).send({ items: deps.db.select().from(sourceRoles).all() });
    },
  );

  app.get(
    '/api/v1/sources/inputs',
    { config: { operationId: 'listPhysicalInputs' }, preHandler: requireAuth(authService, 'listPhysicalInputs') },
    async (_request, reply) => {
      const items = deps.db.select().from(physicalInputs).all().map(toPhysicalInputPayload);
      reply.code(200).send({ items });
    },
  );

  app.put(
    '/api/v1/sources/inputs/:inputId',
    { config: { operationId: 'updatePhysicalInput' }, preHandler: requireAuth(authService, 'updatePhysicalInput') },
    async (request, reply) => {
      const { inputId } = request.params as { inputId: string };
      const patch = parseBody(zPhysicalInputUpdate, request.body);
      const result = await updatePhysicalInput(deps, inputId, patch, request.authContext!);
      reply.code(200).send(result);
    },
  );

  app.get(
    '/api/v1/sources/bindings',
    { config: { operationId: 'listSourceBindings' }, preHandler: requireAuth(authService, 'listSourceBindings') },
    async (_request, reply) => {
      const items = deps.db.select().from(sourceBindings).all().map(toSourceBindingPayload);
      reply.code(200).send({ items });
    },
  );

  app.put(
    '/api/v1/sources/bindings/:roleId',
    { config: { operationId: 'updateSourceBinding' }, preHandler: requireAuth(authService, 'updateSourceBinding') },
    async (request, reply) => {
      const { roleId } = request.params as { roleId: string };
      const patch = parseBody(zSourceBindingUpdate, request.body);
      const result = await updateSourceBinding(deps, roleId, patch, request.authContext!);
      reply.code(200).send(result);
    },
  );
}
