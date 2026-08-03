import {
  zDeviceHealth, zDeviceProvisioning,
  type DeviceHealth, type DeviceProvisioning,
} from '@eduscope/shared';
import { validated, nowIsoZ } from '../seed/index.js';
import type { RestContext } from './index.js';

export function createProvisioningOperations({ world, seed }: RestContext) {
  return {
    getProvisioning: async (): Promise<DeviceProvisioning> =>
      validated(zDeviceProvisioning, seed.provisioning),

    getDeviceHealth: async (): Promise<DeviceHealth> =>
      validated(zDeviceHealth, {
        ...seed.deviceHealth,
        observedAt: nowIsoZ(world.clock),
        captureCardState: world.state('capture-card'),
      }),
  };
}
