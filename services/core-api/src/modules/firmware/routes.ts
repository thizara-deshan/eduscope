import type { FastifyInstance } from 'fastify';
import { ProblemError } from '../../contracts/problem.js';
import { requireAuth } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import { applyFirmware, checkFirmware, getFirmwareState, type FirmwareDeps } from './machine.js';

function assertAdmin(role: 'lecturer' | 'admin'): void {
  if (role !== 'admin') throw new ProblemError(403, 'not-authorized', 'Administrator role required');
}

/** Registers this task's operationIds (openapi.yaml tag `firmware`): `getFirmwareState`, `checkFirmware`, `applyFirmware`. All `x-required-role: admin`. */
export function registerFirmwareRoutes(app: FastifyInstance, authService: AuthService, deps: FirmwareDeps): void {
  app.get(
    '/api/v1/firmware',
    { config: { operationId: 'getFirmwareState' }, preHandler: requireAuth(authService, 'getFirmwareState') },
    async (request, reply) => {
      assertAdmin(request.authContext!.role);
      reply.code(200).send(getFirmwareState(deps));
    },
  );

  app.post(
    '/api/v1/firmware/check',
    { config: { operationId: 'checkFirmware' }, preHandler: requireAuth(authService, 'checkFirmware') },
    async (request, reply) => {
      assertAdmin(request.authContext!.role);
      reply.code(202).send(checkFirmware(deps, request.authContext!));
    },
  );

  app.post(
    '/api/v1/firmware/apply',
    { config: { operationId: 'applyFirmware' }, preHandler: requireAuth(authService, 'applyFirmware') },
    async (request, reply) => {
      assertAdmin(request.authContext!.role);
      reply.code(202).send(applyFirmware(deps, request.authContext!));
    },
  );
}
