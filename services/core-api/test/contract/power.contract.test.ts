import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { zPowerOffDeviceResponse } from '@eduscope/shared';
import { powerOffDevice } from '../../src/modules/device/power.js';

describe('power-off v1 contract', () => {
  it('owns powerOffDevice and its shared response shape; has no x-required-role marker (KEEP B-50: any authenticated role)', () => {
    expect(powerOffDevice).toBeTypeOf('function');
    expect(
      zPowerOffDeviceResponse.safeParse({
        commandId: '01KQHFP680S9YDXZAX7CJ32CKF',
        acceptedAt: '2026-08-19T00:00:00.000Z',
        resolveBySec: 10,
      }).success,
    ).toBe(true);

    const openapi = readFileSync(resolve(import.meta.dirname, '../../../../contracts/openapi.yaml'), 'utf8');
    expect(openapi).toContain('operationId: powerOffDevice');
    const opStart = openapi.indexOf('operationId: powerOffDevice');
    const nextOpStart = openapi.indexOf('operationId:', opStart + 1);
    const opBlock = openapi.slice(opStart, nextOpStart === -1 ? undefined : nextOpStart);
    expect(opBlock).not.toContain('x-required-role');
  });
});
