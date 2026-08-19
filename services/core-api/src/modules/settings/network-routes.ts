import type { CommandAccepted, NetworkConfig } from '@eduscope/shared';
import { TIMERS, zNetworkConfigUpdate } from '@eduscope/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { ProblemError } from '../../contracts/problem.js';
import { parseBody } from '../../contracts/validate.js';
import type { DrizzleDb } from '../../db/client.js';
import { networkConfigs } from '../../db/schema.js';
import type { Clock } from '../../lib/clock.js';
import type { HelperClient } from '../../lib/helper-client.js';
import type { IdGenerator } from '../../lib/ids.js';
import { requireAuth } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import type { AlertStore } from '../device/alerts.js';

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function isValidIpv4(value: string): boolean {
  const match = IPV4_PATTERN.exec(value);
  if (!match) return false;
  return match.slice(1).every((octet) => Number(octet) <= 255);
}

function assertAdmin(role: 'lecturer' | 'admin'): void {
  if (role !== 'admin') throw new ProblemError(403, 'not-authorized', 'Administrator role required');
}

function toPayload(row: typeof networkConfigs.$inferSelect): NetworkConfig {
  return {
    id: row.id,
    interfaceName: row.interfaceName,
    kind: row.kind,
    vlanId: row.vlanId,
    addressMode: row.addressMode,
    ipv4Address: row.ipv4Address,
    prefixLength: row.prefixLength,
    gateway: row.gateway,
    dnsServers: row.dnsServers,
    appliedAt: row.appliedAt,
    lastApplyError: row.lastApplyError,
  };
}

interface RequestedConfig {
  kind: 'lan' | 'vlan';
  vlanId: number | null;
  addressMode: 'dhcp' | 'static';
  ipv4Address: string | null;
  prefixLength: number | null;
  gateway: string | null;
  dnsServers: string[];
}

/** DR: DHCP/static mutual fields (INV-NC-1) and IPv4/prefix/gateway/DNS consistency — Class A guards, never reach the helper. */
function validateRequestedConfig(config: RequestedConfig): void {
  if (config.kind === 'vlan' && config.vlanId === null) {
    throw new ProblemError(422, 'config.invalid', 'vlanId is required when kind is vlan');
  }
  if (config.kind === 'lan' && config.vlanId !== null) {
    throw new ProblemError(422, 'config.invalid', 'vlanId must be null when kind is lan');
  }

  if (config.addressMode === 'static') {
    if (config.ipv4Address === null || config.prefixLength === null || config.gateway === null) {
      throw new ProblemError(422, 'config.invalid', 'ipv4Address, prefixLength, and gateway are required when addressMode is static');
    }
    if (!isValidIpv4(config.ipv4Address)) {
      throw new ProblemError(422, 'config.invalid', 'ipv4Address is not a valid IPv4 address');
    }
    if (!Number.isInteger(config.prefixLength) || config.prefixLength < 0 || config.prefixLength > 32) {
      throw new ProblemError(422, 'config.invalid', 'prefixLength must be between 0 and 32');
    }
    if (!isValidIpv4(config.gateway)) {
      throw new ProblemError(422, 'config.invalid', 'gateway is not a valid IPv4 address');
    }
  } else if (config.ipv4Address !== null || config.prefixLength !== null || config.gateway !== null) {
    throw new ProblemError(422, 'config.invalid', 'ipv4Address, prefixLength, and gateway must be null when addressMode is dhcp');
  }

  for (const dns of config.dnsServers) {
    if (!isValidIpv4(dns)) {
      throw new ProblemError(422, 'config.invalid', `dnsServers entry is not a valid IPv4 address: ${dns}`);
    }
  }
}

export interface NetworkSettingsLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

export interface NetworkSettingsDeps {
  db: DrizzleDb;
  clock: Clock;
  ids: IdGenerator;
  helper: HelperClient;
  alerts: AlertStore;
  logger?: NetworkSettingsLogger;
}

/**
 * Applies the already-validated config through the allowlisted `net.apply`
 * helper verb, outside the request/response cycle. Success commits the row
 * to the requested values with a fresh `appliedAt`; failure leaves every
 * field untouched except `lastApplyError` — the prior applied config is
 * never overwritten by an unapplied request (openapi.yaml updateNetworkConfig:
 * "Outcome is readable on the row"), and a failure also raises a
 * `system.alert`.
 */
async function applyNetworkConfig(deps: NetworkSettingsDeps, row: typeof networkConfigs.$inferSelect, requested: RequestedConfig, actorUserId: string): Promise<void> {
  try {
    await deps.helper.request(
      'net.apply',
      {
        interfaceName: row.interfaceName,
        config: {
          kind: requested.kind,
          vlanId: requested.vlanId,
          addressMode: requested.addressMode,
          ipv4Address: requested.ipv4Address,
          prefixLength: requested.prefixLength,
          gateway: requested.gateway,
          dnsServers: requested.dnsServers,
        },
      },
      deps.ids.next(deps.clock.now()),
    );
  } catch (error) {
    const message = error instanceof ProblemError ? error.title : error instanceof Error ? error.message : String(error);
    deps.db.update(networkConfigs).set({ lastApplyError: message }).where(eq(networkConfigs.id, row.id)).run();
    deps.alerts.raise({
      code: 'network.apply-failed',
      severity: 'error',
      category: 'System',
      title: `Network settings failed to apply for ${row.interfaceName}`,
      detail: message,
      relatedEntity: { type: 'NetworkConfig', id: row.id },
    });
    return;
  }

  deps.db
    .update(networkConfigs)
    .set({
      kind: requested.kind,
      vlanId: requested.vlanId,
      addressMode: requested.addressMode,
      ipv4Address: requested.ipv4Address,
      prefixLength: requested.prefixLength,
      gateway: requested.gateway,
      dnsServers: requested.dnsServers,
      appliedAt: deps.clock.now().toISOString(),
      appliedBy: actorUserId,
      lastApplyError: null,
    })
    .where(eq(networkConfigs.id, row.id))
    .run();
}

/** Registers this task's operationIds (openapi.yaml tag `settings`): `listNetworkConfigs`, `updateNetworkConfig`. Both are `x-required-role: admin`. */
export function registerNetworkSettingsRoutes(app: FastifyInstance, authService: AuthService, deps: NetworkSettingsDeps): void {
  app.get(
    '/api/v1/settings/network',
    { config: { operationId: 'listNetworkConfigs' }, preHandler: requireAuth(authService, 'listNetworkConfigs') },
    async (request, reply) => {
      assertAdmin(request.authContext!.role);
      const items = deps.db.select().from(networkConfigs).all().map(toPayload);
      reply.code(200).send({ items });
    },
  );

  app.put(
    '/api/v1/settings/network/:networkConfigId',
    { config: { operationId: 'updateNetworkConfig' }, preHandler: requireAuth(authService, 'updateNetworkConfig') },
    async (request, reply) => {
      assertAdmin(request.authContext!.role);
      const { networkConfigId } = request.params as { networkConfigId: string };
      const patch = parseBody(zNetworkConfigUpdate, request.body);

      const row = deps.db.select().from(networkConfigs).where(eq(networkConfigs.id, networkConfigId)).get();
      if (!row) {
        throw new ProblemError(422, 'config.invalid', 'Unknown network interface');
      }

      const requested: RequestedConfig = {
        kind: patch.kind ?? row.kind,
        vlanId: patch.vlanId !== undefined ? patch.vlanId : row.vlanId,
        addressMode: patch.addressMode ?? row.addressMode,
        ipv4Address: patch.ipv4Address !== undefined ? patch.ipv4Address : row.ipv4Address,
        prefixLength: patch.prefixLength !== undefined ? patch.prefixLength : row.prefixLength,
        gateway: patch.gateway !== undefined ? patch.gateway : row.gateway,
        dnsServers: patch.dnsServers ?? row.dnsServers,
      };
      validateRequestedConfig(requested);

      const now = deps.clock.now();
      const accepted: CommandAccepted = { commandId: deps.ids.next(now), acceptedAt: now.toISOString(), resolveBySec: TIMERS['T-CMD-RESOLVE'] / 1000 };
      reply.code(202).send(accepted);

      void applyNetworkConfig(deps, row, requested, request.authContext!.userId).catch((error: unknown) => {
        deps.logger?.warn('network config apply failed unexpectedly', { error: error instanceof Error ? error.message : String(error) });
      });
    },
  );
}
