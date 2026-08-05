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

describe('R-03 / R-21 guards (W2-D-11)', () => {
  it('refuses a start while another session is live, instead of throwing in a timer', async () => {
    const client = createMockClient('happy', { seed: { recordingOwnedByOtherUser: true } });
    await expect(client.startRecording()).rejects.toMatchObject({
      problem: { status: 409, code: 'recorder.busy' },
    });
    client.dispose();
  });

  it('refuses a takeover once machine 1a is terminal', async () => {
    const client = createMockClient('happy');
    await client.login({ username: 'admin', password: 'battery-staple', client: 'panel' });
    await expect(client.takeoverRecording()).rejects.toMatchObject({
      problem: { status: 409, code: 'conflict' },
    });
    client.dispose();
  });
});

describe('the preview drops when its role leaves online (S-10)', () => {
  it('emits error{source-offline} and stops frames', async () => {
    const client = createMockClient('happy');
    const preview = client.openPreview();
    const seen: Array<{ type: string; code?: string }> = [];
    preview.messages$.subscribe((m) => seen.push(m as { type: string; code?: string }));
    preview.send({ type: 'offer', negotiationId: 'n1', roleId: 'lecturer-cam', sdp: 'v=0' });
    await new Promise((r) => setTimeout(r, 600));
    expect(seen.some((m) => m.type === 'answer')).toBe(true);

    client.world.apply('HL-06@lecturer-cam');
    await new Promise((r) => setTimeout(r, 50));
    expect(seen.at(-1)).toMatchObject({ type: 'error', code: 'source-offline' });
    preview.close();
    client.dispose();
  });
});
