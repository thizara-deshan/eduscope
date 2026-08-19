import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { zGetUploadJobResponse, zListUploadJobsResponse, zRequeueUploadJobResponse } from '@eduscope/shared';
import { registerUploadRoutes } from '../../src/modules/uploads/routes.js';

describe('upload v1 contract', () => {
  it('keeps all three operationIds wired to shared response validators', () => {
    expect(registerUploadRoutes).toBeTypeOf('function');
    expect(zListUploadJobsResponse.safeParse({ items: [], nextCursor: null }).success).toBe(true);
    expect(zRequeueUploadJobResponse.safeParse({ commandId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', acceptedAt: '2026-07-08T00:00:00.000Z', resolveBySec: 5 }).success).toBe(true);
    expect(zGetUploadJobResponse.safeParse({}).success).toBe(false);
    const contract = readFileSync(resolve(import.meta.dirname, '../../../../contracts/openapi.yaml'), 'utf8');
    expect(contract).toContain('operationId: listUploadJobs');
    expect(contract).toContain('operationId: getUploadJob');
    expect(contract).toContain('operationId: requeueUploadJob');
  });
});
