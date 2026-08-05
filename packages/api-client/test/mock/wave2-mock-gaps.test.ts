import { describe, expect, it } from 'vitest';
import { createMockClient } from '../../src/mock/create-mock-client.js';

describe('audio.control is emitted (events.md §2.7)', () => {
  it('emits the applied truth after updateAudioControl', async () => {
    const client = createMockClient('happy');
    const seen: unknown[] = [];
    client.events$.subscribe((e) => {
      if (e.event === 'audio.control') seen.push(e.payload);
    });
    await client.updateAudioControl('mic-lecturer', { muted: true });
    await new Promise((r) => setTimeout(r, 50));
    expect(seen.at(-1)).toMatchObject({
      roleId: 'mic-lecturer', muted: true, appliedState: 'applied', lastError: null,
    });
    client.dispose();
  });

  it('resolves as failed, with the REQUESTED value not applied, when audioApplyFails is set', async () => {
    const client = createMockClient('happy', { seed: { audioApplyFails: true } });
    const seen: Array<Record<string, unknown>> = [];
    client.events$.subscribe((e) => {
      if (e.event === 'audio.control') seen.push(e.payload as Record<string, unknown>);
    });
    await client.updateAudioControl('mic-lecturer', { muted: true });
    await new Promise((r) => setTimeout(r, 50));
    expect(seen.at(-1)).toMatchObject({ muted: false, appliedState: 'failed' });
    expect(seen.at(-1)?.lastError).toBeTypeOf('string');
    client.dispose();
  });

  it('includes audio.control in the boot snapshot', async () => {
    const client = createMockClient('happy');
    const names = await new Promise<string[]>((resolve) => {
      const seen: string[] = [];
      client.events$.subscribe((e) => seen.push(e.event));
      setTimeout(() => resolve(seen), 50);
    });
    expect(names).toContain('audio.control');
    client.dispose();
  });
});
