import { describe, expect, it } from 'vitest';
import { createVirtualClock } from '../../src/mock/clock.js';
import { createMockClient } from '../../src/mock/create-mock-client.js';

const at = () => createVirtualClock('2026-07-30T09:00:00.000+00:00');

describe('createMockClient', () => {
  it('replays the on-subscribe snapshot before any new event', () => {
    const client = createMockClient('happy', { clock: at() });
    const seen: string[] = [];
    client.events$.subscribe((e) => seen.push(e.event));
    expect(seen).toContain('recording.state');
    expect(seen).toContain('sources.status');
    expect(seen).toContain('storage.status');
  });

  it('drives the happy path from idle to recording', async () => {
    const clock = at();
    const client = createMockClient('happy', { clock });
    await client.startRecording();
    clock.advance(2_000);
    expect(client.world.state('recording')).toBe('recording');
    expect((await client.getRecordingState()).state).toBe('recording');
  });

  it('start-fails refuses Class A first, then lands in Class B error without recording', async () => {
    const clock = at();
    const client = createMockClient('start-fails', { clock });
    const states: string[] = [];
    client.events$.subscribe((e) => {
      if (e.event === 'recording.state') states.push(e.payload.state);
    });
    await expect(client.startRecording()).rejects.toMatchObject({
      problem: { code: 'config.invalid' },
    });
    await client.startRecording();
    clock.advance(3_000);
    expect(states).toContain('error');
    expect(states).not.toContain('recording');
  });

  it('switchScenario resets the world and applies the new script live', async () => {
    const clock = at();
    const client = createMockClient('happy', { clock });
    await client.startRecording();
    clock.advance(2_000);
    expect(client.world.state('recording')).toBe('recording');

    client.switchScenario('start-fails');
    expect(client.scenario).toBe('start-fails');
    expect(client.world.state('recording')).toBe('idle');

    await expect(client.startRecording()).rejects.toMatchObject({
      problem: { code: 'config.invalid' },
    });
    await client.startRecording();
    clock.advance(3_000);
    expect(client.world.state('recording')).toBe('error');
  });

  it('rejects a refused command with a named Problem, never a silent no-op', async () => {
    const client = createMockClient('disk-full', { clock: at() });
    await expect(client.startRecording()).rejects.toMatchObject({
      name: 'ProblemError',
      problem: { code: 'storage.critical' },
    });
  });

  it('keeps the emitted seq monotonic across a scenario switch', () => {
    const clock = at();
    const client = createMockClient('happy', { clock });
    const seqs: number[] = [];
    client.events$.subscribe((e) => seqs.push(e.seq));
    client.switchScenario('ws-flap');
    clock.advance(1_000);
    for (let i = 1; i < seqs.length; i += 1) {
      expect(seqs[i]!).toBeGreaterThan(seqs[i - 1]!);
    }
  });
});

describe('createMockClient — review fixes (C1, I2–I6)', () => {
  it('C1: the WS snapshot carries channel.state for all 3 channels, including local', () => {
    const client = createMockClient('happy', { clock: at() });
    const channelIds: string[] = [];
    client.events$.subscribe((e) => {
      if (e.event === 'channel.state') channelIds.push(e.payload.channelId);
    });
    expect(channelIds).toEqual(expect.arrayContaining(['local', 'meeting', 'streaming']));
    const local = client.world.snapshot().find(
      (e) => e.event === 'channel.state' && e.payload.channelId === 'local',
    );
    expect(local).toMatchObject({
      event: 'channel.state',
      payload: { channelId: 'local', state: 'on', presetId: 'fifty-fifty' },
    });
  });

  it('I2/I4: disk-full storage pressure and byte counts agree across the WS snapshot and both REST reads', async () => {
    const client = createMockClient('disk-full', { clock: at() });
    let wsPayload: { pressure: string; freeBytes: number; totalBytes: number } | undefined;
    client.events$.subscribe((e) => {
      if (e.event === 'storage.status') wsPayload = e.payload;
    });

    const overview = await client.getStorageOverview();
    const health = await client.getDeviceHealth();

    expect(wsPayload?.pressure).toBe('critical');
    expect(overview.pressure).toBe('critical');
    expect(health.storagePressure).toBe('critical');
    expect(wsPayload?.freeBytes).toBe(overview.freeBytes);
    expect(wsPayload?.totalBytes).toBe(overview.totalBytes);
  });

  it('I3: sources.status agrees between the WS snapshot and getSourcesStatus() for every bound role', async () => {
    const client = createMockClient('happy', { clock: at() });
    const wsStates = new Map<string, string>();
    client.events$.subscribe((e) => {
      if (e.event === 'sources.status') wsStates.set(e.payload.roleId, e.payload.state);
    });

    const restStatuses = await client.getSourcesStatus();
    for (const status of restStatuses) {
      expect(wsStates.get(status.roleId)).toBe(status.state);
    }
    expect(wsStates.get('presentation')).toBe('online');
  });

  it('I5: a connection$ subscriber attached after switchScenario still receives live events', () => {
    const clock = at();
    const client = createMockClient('happy', { clock });
    client.switchScenario('ws-flap');

    const phases: string[] = [];
    client.connection$.subscribe((s) => phases.push(s.phase));
    expect(phases).toContain('open'); // replayed immediately on subscribe

    clock.advance(20_000); // past ws-flap's first drop (afterMs: 15_000)
    expect(phases).toContain('reconnecting');
  });

  it('I6: a connection$ subscriber attached after construction still observes the current phase', () => {
    const client = createMockClient('happy', { clock: at() });
    const phases: string[] = [];
    client.connection$.subscribe((s) => phases.push(s.phase));
    expect(phases[0]).toBe('open');
  });
});
