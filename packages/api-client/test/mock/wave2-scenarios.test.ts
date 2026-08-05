import { describe, expect, it } from 'vitest';
import { createMockClient } from '../../src/mock/create-mock-client.js';

describe('per-switch world seeds (W2-D-1)', () => {
  it('applies a seed override passed at construction', async () => {
    const client = createMockClient('happy', { seed: { recordingOwnedByOtherUser: true } });
    const snapshot = await client.getRecordingState();
    expect(snapshot.state).toBe('recording');
    expect(snapshot.ownerDisplayName).toBe('A. Perera');
    client.dispose();
  });

  it('applies a seed override passed at switch time, and drops it on the next switch', async () => {
    const client = createMockClient('happy');
    expect((await client.getRecordingState()).state).toBe('idle');

    client.switchScenario('happy', { aiEnabled: false });
    expect((await client.getProvisioning()).featureFlags.aiQuizEnabled).toBe(false);
    expect(client.worldSeed.aiEnabled).toBe(false);

    client.switchScenario('happy');
    expect((await client.getProvisioning()).featureFlags.aiQuizEnabled).toBe(true);
    client.dispose();
  });

  it('lets the override win over the script seed', async () => {
    const client = createMockClient('disk-full', { seed: { storagePressure: 'warning' } });
    expect((await client.getStorageOverview()).pressure).toBe('warning');
    client.dispose();
  });

  it('seeds a failed mic apply when audioApplyFails is set (W2-D-4)', async () => {
    const client = createMockClient('happy', { seed: { audioApplyFails: true } });
    const [mic] = await client.listAudioControls();
    expect(mic?.appliedState).toBe('failed');
    expect(mic?.lastError).toMatch(/mixer/i);
    client.dispose();
  });
});

describe('script timelines (W2-D-2)', () => {
  it.todo('schedules a timeline transition against the world', async () => {
    const client = createMockClient('pipeline-crash-midway');
    const seen: string[] = [];
    client.events$.subscribe((e) => {
      if (e.event === 'sources.status') seen.push(`${e.payload.roleId}:${e.payload.state}`);
    });
    await new Promise((r) => setTimeout(r, 6_000));
    expect(seen).toContain('lecturer-cam:degraded');
    client.dispose();
  }, 10_000);
});
