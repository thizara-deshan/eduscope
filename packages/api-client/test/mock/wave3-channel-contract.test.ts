import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { zChannelConfig, zChannelStatus, type ChannelId } from '@eduscope/shared';
import type { EduscopeClient } from '../../src/client.js';
import { createVirtualClock, type VirtualClock } from '../../src/mock/clock.js';
import { MockWorld } from '../../src/mock/world.js';
import { ALL_MACHINES } from '../../src/mock/machines/index.js';
import { createScenarioEngine } from '../../src/mock/scenario/engine.js';
import { getScenario } from '../../src/mock/scenario/registry.js';
import { createSeed } from '../../src/mock/seed/index.js';
import { createCredentialStore } from '../../src/mock/seed/users.js';
import { createRestOperations } from '../../src/mock/rest/index.js';

const zChannelSnapshot = z.object({ config: zChannelConfig, status: zChannelStatus });

/** Same hand-built RestContext harness as rest-fixes.test.ts, so this test owns the VirtualClock directly. */
function build() {
  const clock = createVirtualClock('2026-08-08T09:00:00.000Z');
  const world = new MockWorld({ clock });
  for (const m of ALL_MACHINES) world.registerMachine(m);
  const engine = createScenarioEngine(getScenario('happy'));
  const seed = createSeed();
  const ops = createRestOperations({
    world,
    engine,
    seed,
    worldSeed: {
      storagePressure: 'ok',
      aiEnabled: true,
      quizAvailable: true,
      recordingOwnedByOtherUser: false,
      audioApplyFails: false,
      studentsCameraBound: true,
      streamTargetsConfigured: true,
    },
    credentials: createCredentialStore(),
  }) as unknown as EduscopeClient;
  return { world, ops, seed, clock };
}

const LP7: Record<ChannelId, string[]> = {
  local: ['fifty-fifty', 'side-by-side', 'cam-1', 'cam-2', 'separate-files'],
  meeting: ['cams-fifty-fifty', 'cam-1', 'cam-2'],
  streaming: ['fifty-fifty', 'side-by-side', 'cam-1', 'cam-2', 'pc-only'],
};

describe('Wave 3 — channel snapshot and LP-7 contract', () => {
  it('listChannels returns exactly local/meeting/streaming, each a valid { config, status }', async () => {
    const { ops } = build();
    const rows = await ops.listChannels();
    expect(rows.map((r) => r.config.channelId).sort()).toEqual(['local', 'meeting', 'streaming']);
    for (const row of rows) expect(() => zChannelSnapshot.parse(row)).not.toThrow();
  });

  it('allowedChannels produces exactly the LP-7 preset sets', async () => {
    const { ops } = build();
    const presets = await ops.listLayoutPresets();
    for (const channelId of ['local', 'meeting', 'streaming'] as const) {
      const allowed = presets.filter((p) => p.allowedChannels.includes(channelId)).map((p) => p.id).sort();
      expect(allowed).toEqual([...LP7[channelId]].sort());
    }
  });

  it('local defaults to fifty-fifty, is alwaysOn, and cannot be disabled', async () => {
    const { ops, seed } = build();
    const local = seed.channels.find((c) => c.channelId === 'local')!;
    expect(local.presetId).toBe('fifty-fifty');
    expect(local.alwaysOn).toBe(true);
    await expect(ops.disableChannel('local')).rejects.toMatchObject({
      problem: { status: 422, code: 'config.invalid' },
    });
  });

  it('separate-files has exactly two outputs: Presentation (no audio) and Lecturer Camera (audio)', async () => {
    const { ops } = build();
    const presets = await ops.listLayoutPresets();
    const preset = presets.find((p) => p.id === 'separate-files')!;
    expect(preset.outputs).toHaveLength(2);
    expect(preset.outputs.map((o) => o.roleIds)).toEqual([['presentation'], ['lecturer-cam']]);
    expect(preset.outputs[0]!.includeAudio).toBe(false);
    expect(preset.outputs[1]!.includeAudio).toBe(true);
  });

  it('rejects updateChannelConfig with a named 422 when a required role has no enabled binding', async () => {
    const { ops, seed } = build();
    const binding = seed.sourceBindings.find((b) => b.roleId === 'students-cam')!;
    (binding as { enabled: boolean }).enabled = false;
    await expect(
      ops.updateChannelConfig('meeting', { presetId: 'cams-fifty-fifty' }),
    ).rejects.toMatchObject({
      problem: { status: 422, code: 'config.invalid', title: expect.stringContaining('not connected') },
    });
  });

  it('a lecturer may change presetId/enabledByDefault but is refused 403 writing streamTargetIds', async () => {
    const { ops } = build();
    const saved = await ops.updateChannelConfig('streaming', { presetId: 'fifty-fifty', enabledByDefault: true });
    expect(saved.presetId).toBe('fifty-fifty');
    await expect(
      ops.updateChannelConfig('streaming', { streamTargetIds: [] }),
    ).rejects.toMatchObject({ problem: { status: 403, code: 'not-authorized' } });
  });

  it('disabling a failed channel drives CH-10 to off, never an illegal CH-07', async () => {
    const { ops, world, clock } = build();
    world.apply('CH-04'); // off -> starting (schedules CH-05 at +700ms, never advanced past here)
    world.apply('CH-06'); // starting -> failed
    expect(world.state('channel:meeting')).toBe('failed');
    await ops.disableChannel('meeting');
    (clock as VirtualClock).advance(200); // past disableChannel's 150ms plan, short of CH-05's 700ms
    expect(world.state('channel:meeting')).toBe('off');
  });
});
