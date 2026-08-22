import type { FastifyInstance } from 'fastify';
import { storageVolumes } from '../../db/schema.js';
import { requireAuth } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import type { StorageProbe } from './probe.js';

export function registerStorageRoutes(app: FastifyInstance, authService: AuthService, probe: StorageProbe): void {
  app.get(
    '/api/v1/storage',
    { config: { operationId: 'getStorageOverview' }, preHandler: requireAuth(authService, 'getStorageOverview') },
    async (_request, reply) => {
      const snapshot = probe.snapshot();
      const volumes = app.db.select().from(storageVolumes).all().map((row) => ({
        ...row,
        capacityBytes: Number(row.capacityBytes),
        freeBytes: Number(row.freeBytes),
      }));
      reply.code(200).send({
        pressure: snapshot.pressure,
        totalBytes: snapshot.totalBytes,
        freeBytes: snapshot.freeBytes,
        volumes,
        policy: snapshot.policy,
      });
    },
  );
}
