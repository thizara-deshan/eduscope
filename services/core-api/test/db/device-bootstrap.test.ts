import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../../src/db/client.js';
import { loadDeviceBootstrap, seedBootstrapAdmin, pushEnabledBindings } from '../../src/db/device-bootstrap.js';
import { migrate } from '../../src/db/migrate.js';
import { seed } from '../../src/db/seeds.js';
import { networkConfigs, physicalInputs, sourceBindings, users } from '../../src/db/schema.js';
import { UlidGenerator } from '../../src/lib/ids.js';

const now = new Date('2026-01-01T00:00:00Z');
const bootstrap = { version: 1 as const, wiredInterface: 'enP4p65s0', inputs: { presentation: { kind: 'v4l2' as const, address: '/dev/eduscope/pc-capture' }, 'lecturer-cam': { kind: 'rtsp' as const, address: 'rtsp://10.20.30.41/stream1' }, 'students-cam': { kind: 'rtsp' as const, address: 'rtsp://10.20.30.42/stream1' }, 'mic-lecturer': { kind: 'alsa' as const, address: 'eduscope_mic' } }, bootstrapAdmin: { username: 'device-admin', displayName: 'Device Administrator', passwordFile: '/etc/eduscope/bootstrap-admin.password' } };

describe('device bootstrap', () => {
  const dirs: string[] = [];
  afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
  function database() { const dir = mkdtempSync(join(tmpdir(), 'device-bootstrap-')); dirs.push(dir); const core = openDatabase(join(dir, 'core.db')); migrate(core); return { core, dir }; }

  it('validates an exact bootstrap shape', () => {
    const dir = mkdtempSync(join(tmpdir(), 'device-bootstrap-json-')); dirs.push(dir); const path = join(dir, 'bootstrap.json'); writeFileSync(path, JSON.stringify(bootstrap));
    expect(loadDeviceBootstrap(path).wiredInterface).toBe('enP4p65s0');
    writeFileSync(path, JSON.stringify({ ...bootstrap, extra: true }));
    expect(() => loadDeviceBootstrap(path)).toThrow();
  });

  it('seeds aliases once and preserves later administrator changes', () => {
    const { core } = database(); const ids = new UlidGenerator(); seed(core, now, ids, bootstrap);
    expect(core.db.select().from(physicalInputs).all().map((row) => row.address)).toEqual(Object.values(bootstrap.inputs).map((value) => value.address));
    expect(core.db.select().from(networkConfigs).all()[0]?.interfaceName).toBe('enP4p65s0');
    const row = core.db.select().from(physicalInputs).all()[0]!; core.db.update(physicalInputs).set({ address: '/dev/changed' }).run(); seed(core, now, ids, bootstrap);
    expect(core.db.select().from(physicalInputs).all().find((value) => value.id === row.id)?.address).toBe('/dev/changed'); core.close();
  });

  it('creates exactly one forced-reset admin only when users are empty', async () => {
    const { core, dir } = database(); const password = join(dir, 'password'); writeFileSync(password, 'LongBootstrapPassword!\n'); chmodSync(password, 0o600);
    await seedBootstrapAdmin(core, now, new UlidGenerator(), { ...bootstrap.bootstrapAdmin, passwordFile: password }, process.getuid!());
    expect(core.db.select().from(users).all()).toMatchObject([{ username: 'device-admin', role: 'admin', mustResetPassword: true }]);
    rmSync(password); await seedBootstrapAdmin(core, now, new UlidGenerator(), { ...bootstrap.bootstrapAdmin, passwordFile: password }, process.getuid!());
    expect(core.db.select().from(users).all()).toHaveLength(1); core.close();
  });

  it('pushes all enabled current bindings at startup', async () => {
    const { core } = database(); seed(core, now, new UlidGenerator(), bootstrap); const setPublisherBinding = vi.fn().mockResolvedValue({ commandId: 'x' });
    await pushEnabledBindings(core.db, { setPublisherBinding }, { get: () => null });
    expect(setPublisherBinding).toHaveBeenCalledTimes(4);
    expect(core.db.select().from(sourceBindings).all()).toHaveLength(4); core.close();
  });
});
