import { describe, expect, it } from 'vitest';
import { createVirtualClock } from '../../src/mock/clock.js';
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

  it('keeps the signed-in user identity stable across a dev scenario switch', async () => {
    const client = createMockClient('happy');
    const { user: before } = await client.login({ username: 'admin', password: 'battery-staple' });

    client.switchScenario('pipeline-crash-midway');

    expect(await client.getMe()).toMatchObject({ id: before.id, username: 'admin', role: 'admin' });
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
  it('maintains persisted duration across pause and resume without counting the pause gap', async () => {
    const clock = createVirtualClock('2026-08-05T09:00:00.000+00:00');
    const client = createMockClient('happy', { clock });

    await client.startRecording();
    clock.advance(1_200);
    const started = await client.getRecordingState();
    expect(started).toMatchObject({
      state: 'recording',
      recordedDurationMs: 0,
      segmentIndex: 1,
      segmentCount: 1,
      pauseCount: 0,
    });
    expect(started.startedAt).toBe('2026-08-05T09:00:01.200Z');

    clock.advance(3_000);
    await client.pauseRecording();
    clock.advance(250);
    const paused = await client.getRecordingState();
    expect(paused).toMatchObject({ state: 'paused', recordedDurationMs: 3_250, pauseCount: 1 });

    clock.advance(3_000);
    await client.resumeRecording();
    clock.advance(250);
    expect(await client.getRecordingState()).toMatchObject({
      state: 'starting',
      startReason: 'resume',
      startedAt: null,
      recordedDurationMs: 3_250,
    });

    clock.advance(800);
    const resumed = await client.getRecordingState();
    expect(resumed).toMatchObject({
      state: 'recording',
      recordedDurationMs: 3_250,
      segmentIndex: 2,
      segmentCount: 2,
      pauseCount: 1,
    });
    expect(resumed.startedAt).toBe('2026-08-05T09:00:08.500Z');

    clock.advance(2_000);
    const afterTwoSeconds = await client.getRecordingState();
    const displayedMs = afterTwoSeconds.recordedDurationMs!
      + clock.now() - Date.parse(afterTwoSeconds.startedAt!);
    expect(displayedMs).toBe(5_250);
    expect(displayedMs).toBeLessThan(clock.now() - Date.parse(started.startedAt!));
    client.dispose();
  });

  it('crashes the pipeline at 40 seconds and recovers into a new capturing segment', async () => {
    const clock = createVirtualClock('2026-08-05T09:00:00.000+00:00');
    const client = createMockClient('pipeline-crash-midway', { clock });
    const segments: Array<{ state: string; endReason: string | null }> = [];
    const states: string[] = [];

    client.events$.subscribe((event) => {
      if (event.event === 'recording.segment') segments.push(event.payload);
      if (event.event === 'recording.state') states.push(event.payload.state);
    });

    await client.startRecording();
    clock.advance(39_999);
    expect(segments).not.toContainEqual({ state: 'truncated', endReason: 'crash' });

    clock.advance(1);
    expect(segments).toContainEqual(
      expect.objectContaining({ state: 'truncated', endReason: 'crash' }),
    );
    expect(states.at(-1)).toBe('starting');
    expect(await client.getRecordingState()).toMatchObject({
      startedAt: null,
      recordedDurationMs: 38_800,
      segmentIndex: 1,
      segmentCount: 1,
    });

    clock.advance(1_000);
    expect(states.at(-1)).toBe('recording');
    expect(segments.at(-1)).toEqual(
      expect.objectContaining({ state: 'capturing', endReason: null }),
    );
    expect(await client.getRecordingState()).toMatchObject({
      startedAt: '2026-08-05T09:00:41.000Z',
      recordedDurationMs: 38_800,
      segmentIndex: 2,
      segmentCount: 2,
    });
    client.dispose();
  });

  it('schedules a timeline transition against the world', async () => {
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
