import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UlidGenerator } from '../../src/lib/ids.js';
import { openDatabase, type CoreDatabase } from '../../src/db/client.js';
import { migrate } from '../../src/db/migrate.js';
import { seed } from '../../src/db/seeds.js';
import {
  channelConfigs,
  encodingProfiles,
  layoutPresets,
  physicalInputs,
  retentionPolicy,
  sourceBindings,
  sourceRoles,
} from '../../src/db/schema.js';
import { FakeClock } from '../fakes/clock.js';

const NOW = new Date('2026-01-01T00:00:00.000Z');

describe('migrations', () => {
  let dir: string;
  let dbPath: string;
  let core: CoreDatabase;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'core-api-migrations-'));
    dbPath = join(dir, 'core.db');
    core = openDatabase(dbPath);
  });

  afterEach(() => {
    core.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('configures the mandated PRAGMAs (design/core-api.md §3.1)', () => {
    expect(core.raw.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(core.raw.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(core.raw.pragma('synchronous', { simple: true })).toBe(1);
    expect(core.raw.pragma('busy_timeout', { simple: true })).toBe(5000);
  });

  it('is idempotent — a second migrate() call against an up-to-date DB is a no-op', () => {
    migrate(core);

    expect(() => migrate(core)).not.toThrow();

    const tables = core.raw
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'")
      .all();
    expect(tables).toHaveLength(1);
  });

  describe('seed counts', () => {
    const clock = new FakeClock(NOW);
    const ids = new UlidGenerator();

    beforeEach(() => {
      migrate(core);
    });

    it('seeds exactly 5 source roles', () => {
      seed(core, clock.now(), ids);
      const rows = core.db.select().from(sourceRoles).all();
      expect(rows).toHaveLength(5);
    });

    it('seeds exactly 7 layout presets', () => {
      seed(core, clock.now(), ids);
      const rows = core.db.select().from(layoutPresets).all();
      expect(rows).toHaveLength(7);
    });

    it('seeds exactly 3 channel configs', () => {
      seed(core, clock.now(), ids);
      const rows = core.db.select().from(channelConfigs).all();
      expect(rows).toHaveLength(3);
    });

    it('seeds exactly 4 physical-input skeletons and bindings (mic-room excluded, INV-SR-2)', () => {
      seed(core, clock.now(), ids);
      expect(core.db.select().from(physicalInputs).all()).toHaveLength(4);
      expect(core.db.select().from(sourceBindings).all()).toHaveLength(4);
    });

    it('seeds exactly 1 retention policy', () => {
      seed(core, clock.now(), ids);
      const rows = core.db.select().from(retentionPolicy).all();
      expect(rows).toHaveLength(1);
    });

    it('seeds exactly 1 device-default encoding profile', () => {
      seed(core, clock.now(), ids);
      const rows = core.db.select().from(encodingProfiles).all();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.scope).toBe('device-default');
    });

    it('re-running seed() is idempotent — counts stay the same', () => {
      seed(core, clock.now(), ids);
      seed(core, clock.now(), ids);

      expect(core.db.select().from(sourceRoles).all()).toHaveLength(5);
      expect(core.db.select().from(layoutPresets).all()).toHaveLength(7);
      expect(core.db.select().from(channelConfigs).all()).toHaveLength(3);
      expect(core.db.select().from(physicalInputs).all()).toHaveLength(4);
      expect(core.db.select().from(sourceBindings).all()).toHaveLength(4);
      expect(core.db.select().from(retentionPolicy).all()).toHaveLength(1);
      expect(core.db.select().from(encodingProfiles).all()).toHaveLength(1);
    });
  });
});
