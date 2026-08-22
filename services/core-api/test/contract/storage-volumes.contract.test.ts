import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { zFormatStorageVolumeResponse, zRegisterStorageVolumeResponse } from '@eduscope/shared';
import { HelperClient } from '../../src/lib/helper-client.js';
import { registerStorageVolumeRoutes } from '../../src/modules/storage/volume-routes.js';

describe('storage volume v1 contracts', () => {
  it('owns the two operations and shared response shapes', () => {
    expect(HelperClient).toBeTypeOf('function');
    expect(registerStorageVolumeRoutes).toBeTypeOf('function');
    expect(zRegisterStorageVolumeResponse.safeParse({ id: '01KQHFP680S9YDXZAX7CJ32CKF', uuid: 'vol-1', devicePath: '/dev/sdb1', mountPath: '/media/eduscope/vol-1', label: 'Disk', filesystem: 'ext4', capacityBytes: 1000, freeBytes: 900, smartStatus: 'unknown', role: 'recordings', state: 'mounted', registeredAt: '2026-08-19T00:00:00.000Z' }).success).toBe(true);
    expect(zFormatStorageVolumeResponse.safeParse({ commandId: '01KQHFP680S9YDXZAX7CJ32CKF', acceptedAt: '2026-08-19T00:00:00.000Z', resolveBySec: 10 }).success).toBe(true);
    const openapi = readFileSync(resolve(import.meta.dirname, '../../../../contracts/openapi.yaml'), 'utf8');
    expect(openapi).toContain('operationId: registerStorageVolume');
    expect(openapi).toContain('operationId: formatStorageVolume');
  });
});
