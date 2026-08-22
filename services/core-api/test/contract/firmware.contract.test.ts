import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { zApplyFirmwareResponse, zCheckFirmwareResponse, zGetFirmwareStateResponse } from '@eduscope/shared';
import { registerFirmwareRoutes } from '../../src/modules/firmware/routes.js';

const SAMPLE_FIRMWARE = {
  id: '01KQHFP680S9YDXZAX7CJ32CKF',
  currentVersion: '0.1.0',
  availableVersion: '0.2.0',
  state: 'idle' as const,
  signatureVerified: true,
  rollbackVersion: null,
  startedAt: null,
  finishedAt: null,
  lastError: null,
};

describe('firmware v1 contracts', () => {
  it('owns getFirmwareState/checkFirmware/applyFirmware, all x-required-role: admin, and their shared response shapes', () => {
    expect(registerFirmwareRoutes).toBeTypeOf('function');

    expect(zGetFirmwareStateResponse.safeParse(SAMPLE_FIRMWARE).success).toBe(true);
    expect(
      zCheckFirmwareResponse.safeParse({ commandId: '01KQHFP680S9YDXZAX7CJ32CKF', acceptedAt: '2026-08-19T00:00:00.000Z', resolveBySec: 10 }).success,
    ).toBe(true);
    expect(
      zApplyFirmwareResponse.safeParse({ commandId: '01KQHFP680S9YDXZAX7CJ32CKF', acceptedAt: '2026-08-19T00:00:00.000Z', resolveBySec: 10 }).success,
    ).toBe(true);

    for (const state of ['idle', 'checking', 'downloading', 'verifying', 'applying', 'rolled-back', 'failed', 'done']) {
      expect(zGetFirmwareStateResponse.safeParse({ ...SAMPLE_FIRMWARE, state }).success).toBe(true);
    }

    const openapi = readFileSync(resolve(import.meta.dirname, '../../../../contracts/openapi.yaml'), 'utf8');
    for (const operationId of ['getFirmwareState', 'checkFirmware', 'applyFirmware']) {
      expect(openapi).toContain(`operationId: ${operationId}`);
      const opStart = openapi.indexOf(`operationId: ${operationId}`);
      const nextOpStart = openapi.indexOf('operationId:', opStart + 1);
      const opBlock = openapi.slice(opStart, nextOpStart === -1 ? undefined : nextOpStart);
      expect(opBlock).toContain('x-required-role: admin');
    }
  });
});
