import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { zListNetworkConfigsResponse, zUpdateNetworkConfigResponse } from '@eduscope/shared';
import { registerNetworkSettingsRoutes } from '../../src/modules/settings/network-routes.js';

describe('network settings v1 contracts', () => {
  it('owns listNetworkConfigs/updateNetworkConfig, both x-required-role: admin, and their shared response shapes', () => {
    expect(registerNetworkSettingsRoutes).toBeTypeOf('function');

    expect(
      zListNetworkConfigsResponse.safeParse({
        items: [
          {
            id: '01KQHFP680S9YDXZAX7CJ32CKF',
            interfaceName: 'eth0',
            kind: 'lan',
            vlanId: null,
            addressMode: 'dhcp',
            ipv4Address: null,
            prefixLength: null,
            gateway: null,
            dnsServers: [],
            appliedAt: null,
            lastApplyError: null,
          },
        ],
      }).success,
    ).toBe(true);

    expect(zUpdateNetworkConfigResponse.safeParse({ commandId: '01KQHFP680S9YDXZAX7CJ32CKF', acceptedAt: '2026-08-19T00:00:00.000Z', resolveBySec: 10 }).success).toBe(true);

    const openapi = readFileSync(resolve(import.meta.dirname, '../../../../contracts/openapi.yaml'), 'utf8');
    expect(openapi).toContain('operationId: listNetworkConfigs');
    expect(openapi).toContain('operationId: updateNetworkConfig');
    for (const operationId of ['listNetworkConfigs', 'updateNetworkConfig']) {
      const opStart = openapi.indexOf(`operationId: ${operationId}`);
      const nextOpStart = openapi.indexOf('operationId:', opStart + 1);
      const opBlock = openapi.slice(opStart, nextOpStart === -1 ? undefined : nextOpStart);
      expect(opBlock).toContain('x-required-role: admin');
    }

    // No frontend build command/path exists in this service (INV-NC-2: static-IP apply never rebuilds a frontend).
    const packageJson = readFileSync(resolve(import.meta.dirname, '../../package.json'), 'utf8');
    expect(packageJson).not.toMatch(/build.*frontend|npm run build/i);
  });
});
