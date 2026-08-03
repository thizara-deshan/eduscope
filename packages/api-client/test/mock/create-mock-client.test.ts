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

  it('start-fails lands in error and never passes through recording', async () => {
    const clock = at();
    const client = createMockClient('start-fails', { clock });
    const states: string[] = [];
    client.events$.subscribe((e) => {
      if (e.event === 'recording.state') states.push(e.payload.state);
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
