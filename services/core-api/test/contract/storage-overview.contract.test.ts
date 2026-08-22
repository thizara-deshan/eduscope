import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { zGetStorageOverviewResponse, zStorageStatusPayload } from '@eduscope/shared';
import { registerStorageRoutes } from '../../src/modules/storage/routes.js';

describe('storage overview v1 contract', () => {
  it('wires getStorageOverview and validates the shared REST/event shape', () => {
    expect(registerStorageRoutes).toBeTypeOf('function');
    const policy = { maxAgeDays: 14, warningThresholdPct: 80, criticalThresholdPct: 95, earlyDeleteOrder: 'uploaded-oldest-first' as const, neverDeleteUnuploaded: true, refuseStartWhenCritical: true };
    expect(zGetStorageOverviewResponse.safeParse({ pressure: 'warning', totalBytes: 100, freeBytes: 20, volumes: [], policy }).success).toBe(true);
    expect(zStorageStatusPayload.safeParse({ pressure: 'warning', totalBytes: 100, freeBytes: 20, policy }).success).toBe(true);
    expect(readFileSync(resolve(import.meta.dirname, '../../../../contracts/openapi.yaml'), 'utf8')).toContain('operationId: getStorageOverview');
  });
});
