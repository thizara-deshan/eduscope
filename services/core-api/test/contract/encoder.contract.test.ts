import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { zGetEncoderSettingsResponse, zUpdateEncoderSettingsResponse } from '@eduscope/shared';
import { registerEncoderSettingsRoutes, DEVICE_ENCODER_CAPABILITIES } from '../../src/modules/settings/encoder-routes.js';

const SAMPLE_PROFILE = {
  id: '01KQHFP680S9YDXZAX7CJ32CKF',
  scope: 'device-default' as const,
  channelId: null,
  videoBitrateKbps: 4000,
  framerate: 30,
  gop: 60,
  rateControl: 'cbr' as const,
  codec: 'h264' as const,
  container: 'mpegts' as const,
  audioCodec: 'aac' as const,
  audioBitrateKbps: 128,
  capabilityVerifiedAt: null,
};

describe('encoder settings v1 contracts', () => {
  it('owns getEncoderSettings/updateEncoderSettings, both x-required-role: admin, and their shared response shapes', () => {
    expect(registerEncoderSettingsRoutes).toBeTypeOf('function');

    expect(zGetEncoderSettingsResponse.safeParse({ profile: SAMPLE_PROFILE, capabilities: DEVICE_ENCODER_CAPABILITIES }).success).toBe(true);
    expect(zUpdateEncoderSettingsResponse.safeParse(SAMPLE_PROFILE).success).toBe(true);

    const openapi = readFileSync(resolve(import.meta.dirname, '../../../../contracts/openapi.yaml'), 'utf8');
    expect(openapi).toContain('operationId: getEncoderSettings');
    expect(openapi).toContain('operationId: updateEncoderSettings');
    for (const operationId of ['getEncoderSettings', 'updateEncoderSettings']) {
      const opStart = openapi.indexOf(`operationId: ${operationId}`);
      const nextOpStart = openapi.indexOf('operationId:', opStart + 1);
      const opBlock = openapi.slice(opStart, nextOpStart === -1 ? undefined : nextOpStart);
      expect(opBlock).toContain('x-required-role: admin');
    }
  });

  it('DEVICE_ENCODER_CAPABILITIES stays within the contract-declared videoBitrateKbps bound (2000-8000)', () => {
    expect(DEVICE_ENCODER_CAPABILITIES.videoBitrateKbps.min).toBeGreaterThanOrEqual(2000);
    expect(DEVICE_ENCODER_CAPABILITIES.videoBitrateKbps.max).toBeLessThanOrEqual(8000);
  });
});
