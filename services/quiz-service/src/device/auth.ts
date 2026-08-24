import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { devices } from '../db/schema.js';
import { ProblemError } from '../contracts/problem.js';
import { verifyDeviceCredential } from './credentials.js';

export interface DevicePrincipal {
  deviceId: string;
  hallDisplayName: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    deviceContext?: DevicePrincipal;
  }
}

const EXPECTED_CONTRACT_VERSION = '1.0';
const BEARER_PREFIX = 'Bearer ';

function authenticationFailure(): ProblemError {
  return new ProblemError(401, 'not-authorized', 'Device authentication failed');
}

function readContractHeader(request: FastifyRequest): string | undefined {
  const value = request.headers['x-eduscope-contract'];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Static per-device bearer boundary for every quiz-sync device route.
 * Tries the token against every enabled device's Argon2id hash — there is
 * no plaintext lookup key, only a one-way hash per device (DR-03). Never
 * logs the header, token, or a hash.
 */
export async function authenticateDevice(request: FastifyRequest): Promise<DevicePrincipal> {
  const header = request.headers.authorization;
  if (!header?.startsWith(BEARER_PREFIX)) {
    throw authenticationFailure();
  }
  const token = header.slice(BEARER_PREFIX.length);
  if (token.length === 0) {
    throw authenticationFailure();
  }

  const enabledDevices = await request.server.db
    .select({
      deviceId: devices.deviceId,
      credentialHash: devices.credentialHash,
      hallDisplayName: devices.hallDisplayName,
    })
    .from(devices)
    .where(eq(devices.enabled, true));

  let principal: DevicePrincipal | undefined;
  for (const device of enabledDevices) {
    if (await verifyDeviceCredential(device.credentialHash, token)) {
      principal = { deviceId: device.deviceId, hallDisplayName: device.hallDisplayName };
      break;
    }
  }

  if (!principal) {
    throw authenticationFailure();
  }

  request.deviceContext = principal;

  const receivedContract = readContractHeader(request);
  if (receivedContract !== undefined && receivedContract !== EXPECTED_CONTRACT_VERSION) {
    request.log.warn(
      {
        deviceId: principal.deviceId,
        method: request.method,
        path: request.url,
        received: receivedContract,
        expected: EXPECTED_CONTRACT_VERSION,
      },
      'quiz-sync contract version mismatch',
    );
  }

  return principal;
}
