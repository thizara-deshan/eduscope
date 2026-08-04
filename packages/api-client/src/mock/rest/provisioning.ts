import {
  zDeviceHealth, zDeviceProvisioning,
  type DeviceHealth, type DeviceProvisioning,
} from '@eduscope/shared';
import { ProblemError } from '../../errors.js';
import { validated, nowIsoZ } from '../seed/index.js';
import type { RestContext } from './index.js';

export function createProvisioningOperations({ world, engine, seed }: RestContext) {
  return {
    getProvisioning: async (): Promise<DeviceProvisioning> => {
      // Reads refuse too. `auth.session-revoked` is a read-time refusal — the
      // session died between one request and the next — and this is S-03's
      // first authenticated read, so it is where a revoked session surfaces
      // (W1-D-6). Without the hook, `auth-failures` cannot reach S-01's
      // `session expired` at all in Wave 1.
      const refusal = engine.onCommand('getProvisioning');
      if (refusal) throw new ProblemError(refusal);
      return validated(zDeviceProvisioning, seed.provisioning);
    },

    getDeviceHealth: async (): Promise<DeviceHealth> =>
      validated(zDeviceHealth, {
        ...seed.deviceHealth,
        observedAt: nowIsoZ(world.clock),
        captureCardState: world.state('capture-card'),
      }),
  };
}
