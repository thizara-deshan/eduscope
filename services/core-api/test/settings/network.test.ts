import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { FastifyInstance } from 'fastify';
import type { NetworkConfig } from '@eduscope/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { users } from '../../src/db/schema.js';
import { UlidGenerator } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';
import { FakeClock } from '../fakes/clock.js';
import { InMemoryHelperTransport } from '../fakes/helper-server.js';
import { FakePipelineManager } from '../fakes/pipeline-manager.js';

const NOW = new Date('2026-08-19T00:00:00.000Z');
const BEARER = 'network-test-pm-bearer';

interface TestApp {
  app: FastifyInstance;
  dir: string;
  pm: FakePipelineManager;
  transport: InMemoryHelperTransport;
  lecturerToken: string;
  adminToken: string;
}

async function loginAs(app: FastifyInstance, username: string, password: string): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password, client: 'panel' } });
  return (response.json() as { tokens: { accessToken: string } }).tokens.accessToken;
}

async function startTestApp(): Promise<TestApp> {
  const dir = mkdtempSync(join(tmpdir(), 'core-api-network-'));
  const pm = new FakePipelineManager({ bearerToken: BEARER });
  const pmBaseUrl = await pm.listen();

  const provisioningPath = join(dir, 'provisioning.json');
  writeFileSync(provisioningPath, JSON.stringify({ deviceId: 'device-1', hallCode: 'LAC001', hallDisplayName: 'Lecture Hall 1', titlePattern: '{hall} – {date} {time}' }));

  const config = loadConfig({
    NODE_ENV: 'test',
    CORE_API_DB_PATH: join(dir, 'core.db'),
    CORE_API_JWT_SECRET: 'network-test-secret',
    CORE_API_PROVISIONING_PATH: provisioningPath,
    CORE_API_RECORDINGS_ROOT: join(dir, 'recordings'),
    CORE_API_PM_BASE_URL: pmBaseUrl,
    CORE_API_INTERNAL_BEARER: BEARER,
  });

  const ids = new UlidGenerator();
  const transport = new InMemoryHelperTransport();
  const app = await buildApp({ config, clock: new FakeClock(NOW), ids, helperTransport: transport });
  await app.lifecycle.start();

  await app.db.insert(users).values([
    { id: ids.next(NOW), username: 'lecturer1', displayName: 'Lecturer', role: 'lecturer', source: 'local', passwordHash: await hashPassword('Password1'), mustResetPassword: false, disabled: false, createdAt: NOW.toISOString() },
    { id: ids.next(NOW), username: 'admin1', displayName: 'Admin', role: 'admin', source: 'local', passwordHash: await hashPassword('Password1'), mustResetPassword: false, disabled: false, createdAt: NOW.toISOString() },
  ]).run();

  const lecturerToken = await loginAs(app, 'lecturer1', 'Password1');
  const adminToken = await loginAs(app, 'admin1', 'Password1');

  return { app, dir, pm, transport, lecturerToken, adminToken };
}

async function stopTestApp(testApp: TestApp): Promise<void> {
  await testApp.app.close();
  await testApp.pm.close();
  rmSync(testApp.dir, { recursive: true, force: true });
}

async function getEth0(testApp: TestApp, token: string): Promise<NetworkConfig> {
  const response = await testApp.app.inject({ method: 'GET', url: '/api/v1/settings/network', headers: { authorization: `Bearer ${token}` } });
  const items = (response.json() as { items: NetworkConfig[] }).items;
  return items.find((item) => item.interfaceName === 'eth0')!;
}

describe('network settings (openapi.yaml tag: settings — listNetworkConfigs, updateNetworkConfig)', () => {
  let testApp: TestApp;
  afterEach(async () => stopTestApp(testApp));

  it('listNetworkConfigs: the one known wired interface, no Wi-Fi fields, admin-only', async () => {
    testApp = await startTestApp();
    const lecturerResponse = await testApp.app.inject({ method: 'GET', url: '/api/v1/settings/network', headers: { authorization: `Bearer ${testApp.lecturerToken}` } });
    expect(lecturerResponse.statusCode).toBe(403);

    const eth0 = await getEth0(testApp, testApp.adminToken);
    expect(eth0.kind).toBe('lan');
    expect(eth0.addressMode).toBe('dhcp');
    expect(eth0.appliedAt).toBeNull();
  });

  it('updateNetworkConfig: admin-only', async () => {
    testApp = await startTestApp();
    const eth0 = await getEth0(testApp, testApp.adminToken);
    const response = await testApp.app.inject({
      method: 'PUT',
      url: `/api/v1/settings/network/${eth0.id}`,
      headers: { authorization: `Bearer ${testApp.lecturerToken}` },
      payload: { addressMode: 'dhcp' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('unknown interface id returns config.invalid', async () => {
    testApp = await startTestApp();
    const response = await testApp.app.inject({ method: 'PUT', url: '/api/v1/settings/network/does-not-exist', headers: { authorization: `Bearer ${testApp.adminToken}` }, payload: { addressMode: 'dhcp' } });
    expect(response.statusCode).toBe(422);
    expect((response.json() as { code: string }).code).toBe('config.invalid');
  });

  it('static requires ipv4Address/prefixLength/gateway; dhcp forbids them', async () => {
    testApp = await startTestApp();
    const eth0 = await getEth0(testApp, testApp.adminToken);

    const missing = await testApp.app.inject({ method: 'PUT', url: `/api/v1/settings/network/${eth0.id}`, headers: { authorization: `Bearer ${testApp.adminToken}` }, payload: { addressMode: 'static' } });
    expect(missing.statusCode).toBe(422);

    const dhcpWithIp = await testApp.app.inject({ method: 'PUT', url: `/api/v1/settings/network/${eth0.id}`, headers: { authorization: `Bearer ${testApp.adminToken}` }, payload: { addressMode: 'dhcp', ipv4Address: '10.0.0.5' } });
    expect(dhcpWithIp.statusCode).toBe(422);

    expect(testApp.transport.ledger).toEqual([]);
  });

  it('rejects malformed IPv4/prefix/gateway/dns values before reaching the helper', async () => {
    testApp = await startTestApp();
    const eth0 = await getEth0(testApp, testApp.adminToken);
    const base = { addressMode: 'static' as const, ipv4Address: '10.0.0.5', prefixLength: 24, gateway: '10.0.0.1', dnsServers: ['10.0.0.2'] };

    for (const bad of [
      { ...base, ipv4Address: 'not-an-ip' },
      { ...base, prefixLength: 33 },
      { ...base, gateway: '999.0.0.1' },
      { ...base, dnsServers: ['nope'] },
    ]) {
      const response = await testApp.app.inject({ method: 'PUT', url: `/api/v1/settings/network/${eth0.id}`, headers: { authorization: `Bearer ${testApp.adminToken}` }, payload: bad });
      expect(response.statusCode).toBe(422);
    }
    expect(testApp.transport.ledger).toEqual([]);
  });

  it('success: 202 pending, exact net.apply helper args, appliedAt set on the next read', async () => {
    testApp = await startTestApp();
    const eth0 = await getEth0(testApp, testApp.adminToken);

    const response = await testApp.app.inject({
      method: 'PUT',
      url: `/api/v1/settings/network/${eth0.id}`,
      headers: { authorization: `Bearer ${testApp.adminToken}` },
      payload: { addressMode: 'static', ipv4Address: '10.0.0.5', prefixLength: 24, gateway: '10.0.0.1', dnsServers: ['10.0.0.2', '10.0.0.3'] },
    });
    expect(response.statusCode).toBe(202);
    const accepted = response.json() as { commandId: string; resolveBySec: number };
    expect(accepted.commandId).toBeTruthy();
    expect(accepted.resolveBySec).toBeGreaterThan(0);

    expect(testApp.transport.ledger).toEqual([
      {
        verb: 'net.apply',
        args: {
          interfaceName: 'eth0',
          config: { kind: 'lan', vlanId: null, addressMode: 'static', ipv4Address: '10.0.0.5', prefixLength: 24, gateway: '10.0.0.1', dnsServers: ['10.0.0.2', '10.0.0.3'] },
        },
        requestId: expect.any(String),
      },
    ]);

    await delay(10);
    const updated = await getEth0(testApp, testApp.adminToken);
    expect(updated.appliedAt).toBeTruthy();
    expect(updated.lastApplyError).toBeNull();
    expect(updated.ipv4Address).toBe('10.0.0.5');
  });

  it('failure: prior config is retained, lastApplyError is set, and a system.alert is raised', async () => {
    testApp = await startTestApp();
    const eth0 = await getEth0(testApp, testApp.adminToken);
    testApp.transport.failureVerb = 'net.apply';

    const response = await testApp.app.inject({
      method: 'PUT',
      url: `/api/v1/settings/network/${eth0.id}`,
      headers: { authorization: `Bearer ${testApp.adminToken}` },
      payload: { addressMode: 'static', ipv4Address: '10.0.0.9', prefixLength: 24, gateway: '10.0.0.1', dnsServers: [] },
    });
    expect(response.statusCode).toBe(202);

    await delay(10);
    const updated = await getEth0(testApp, testApp.adminToken);
    expect(updated.appliedAt).toBeNull();
    expect(updated.addressMode).toBe('dhcp'); // prior config retained, not the failed request
    expect(updated.lastApplyError).toBeTruthy();
    expect(testApp.app.alertStore.list(false).some((alert) => alert.code === 'network.apply-failed')).toBe(true);
  });
});
