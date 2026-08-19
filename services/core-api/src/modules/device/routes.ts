import type { FastifyInstance } from 'fastify';
import { ProblemError } from '../../contracts/problem.js';
import { requireAuth } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import type { AlertStore } from './alerts.js';
import type { HealthAggregator } from './health.js';
import type { ProvisioningReader } from './provisioning.js';

export interface DeviceRoutesDeps {
  provisioning: ProvisioningReader;
  health: HealthAggregator;
  alerts: AlertStore;
}

/** Registers this task's operationIds (openapi.yaml tag `provisioning`/`device`): `getProvisioning`, `getDeviceHealth`, `listAlerts`, `acknowledgeAlert`. None are `x-required-role: admin` — every authenticated role reads them. */
export function registerDeviceRoutes(app: FastifyInstance, authService: AuthService, deps: DeviceRoutesDeps): void {
  app.get(
    '/api/v1/provisioning',
    { config: { operationId: 'getProvisioning' }, preHandler: requireAuth(authService, 'getProvisioning') },
    async (_request, reply) => {
      reply.code(200).send(deps.provisioning.read());
    },
  );

  app.get(
    '/api/v1/health',
    { config: { operationId: 'getDeviceHealth' }, preHandler: requireAuth(authService, 'getDeviceHealth') },
    async (_request, reply) => {
      reply.code(200).send(deps.health.snapshot());
    },
  );

  app.get(
    '/api/v1/alerts',
    { config: { operationId: 'listAlerts' }, preHandler: requireAuth(authService, 'listAlerts') },
    async (request, reply) => {
      const { includeCleared } = request.query as { includeCleared?: string };
      reply.code(200).send({ items: deps.alerts.list(includeCleared === 'true') });
    },
  );

  app.post(
    '/api/v1/alerts/:alertId/acknowledge',
    { config: { operationId: 'acknowledgeAlert' }, preHandler: requireAuth(authService, 'acknowledgeAlert') },
    async (request, reply) => {
      const { alertId } = request.params as { alertId: string };
      const actor = request.authContext!;
      try {
        reply.code(200).send(deps.alerts.acknowledge(alertId, actor.userId));
      } catch {
        throw new ProblemError(404, 'not-found', 'Alert not found');
      }
    },
  );
}
