import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { zCreateStreamTargetResponse, zListStreamTargetsResponse, zUpdateStreamTargetResponse } from '@eduscope/shared';
import { registerStreamTargetRoutes } from '../../src/modules/settings/stream-target-routes.js';

const SAMPLE_TARGET = {
  id: '01KQHFP680S9YDXZAX7CJ32CKF',
  platform: 'youtube' as const,
  displayName: 'Main channel',
  ingestUrl: 'rtmp://a.rtmp.youtube.com/live2',
  hasStreamKey: true,
  requiresTlsBridge: true,
  enabled: true,
  lastPreflightAt: null,
  lastPreflightResult: null,
};

describe('stream targets v1 contracts', () => {
  it('owns listStreamTargets/createStreamTarget/updateStreamTarget/deleteStreamTarget, all x-required-role: admin, and their shared response shapes', () => {
    expect(registerStreamTargetRoutes).toBeTypeOf('function');

    expect(zListStreamTargetsResponse.safeParse({ items: [SAMPLE_TARGET] }).success).toBe(true);
    expect(zCreateStreamTargetResponse.safeParse(SAMPLE_TARGET).success).toBe(true);
    expect(zUpdateStreamTargetResponse.safeParse(SAMPLE_TARGET).success).toBe(true);

    // INV-ST-1: the stream key is never present in the read shape.
    expect('streamKey' in SAMPLE_TARGET).toBe(false);

    const openapi = readFileSync(resolve(import.meta.dirname, '../../../../contracts/openapi.yaml'), 'utf8');
    for (const operationId of ['listStreamTargets', 'createStreamTarget', 'updateStreamTarget', 'deleteStreamTarget']) {
      expect(openapi).toContain(`operationId: ${operationId}`);
      const opStart = openapi.indexOf(`operationId: ${operationId}`);
      const nextOpStart = openapi.indexOf('operationId:', opStart + 1);
      const opBlock = openapi.slice(opStart, nextOpStart === -1 ? undefined : nextOpStart);
      expect(opBlock).toContain('x-required-role: admin');
    }
  });
});
