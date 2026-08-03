import { describe, expect, it } from 'vitest';
import type { PreviewServerMessage } from '@eduscope/shared';
import { createVirtualClock } from '../../src/mock/clock.js';
import { MockWorld } from '../../src/mock/world.js';
import { sourceMachine } from '../../src/mock/machines/health.js';
import { createPreviewChannel, isMockPreviewFrame } from '../../src/mock/events/preview.js';

function world() {
  const clock = createVirtualClock('2026-07-30T09:00:00.000+00:00');
  const w = new MockWorld({ clock });
  w.registerMachine(sourceMachine('lecturer-cam'));
  return { w, clock };
}

describe('createPreviewChannel', () => {
  it('errors source-unbound for a role with no registered machine 5a instance', () => {
    const { w } = world();
    const channel = createPreviewChannel(w);
    const seen: PreviewServerMessage[] = [];
    channel.messages$.subscribe((m) => seen.push(m));
    // mic-room is permanently unbound (INV-SR-2, A-08) and is never registered.
    channel.send({ type: 'offer', negotiationId: 'neg-1', roleId: 'mic-room', sdp: 'sdp-1' });
    expect(seen).toEqual([
      { type: 'error', negotiationId: 'neg-1', code: 'source-unbound', message: expect.any(String) },
    ]);
  });

  it('errors source-unbound for a role explicitly in the `unbound` state', () => {
    const { w } = world();
    w.apply('HL-01@lecturer-cam'); // unknown -> unbound
    const channel = createPreviewChannel(w);
    const seen: PreviewServerMessage[] = [];
    channel.messages$.subscribe((m) => seen.push(m));
    channel.send({ type: 'offer', negotiationId: 'neg-1', roleId: 'lecturer-cam', sdp: 'sdp-1' });
    expect(seen).toEqual([
      { type: 'error', negotiationId: 'neg-1', code: 'source-unbound', message: expect.any(String) },
    ]);
  });

  it('errors source-offline for a registered role that is not online', () => {
    const { w } = world();
    w.apply('HL-03@lecturer-cam'); // unknown -> offline
    const channel = createPreviewChannel(w);
    const seen: PreviewServerMessage[] = [];
    channel.messages$.subscribe((m) => seen.push(m));
    channel.send({ type: 'offer', negotiationId: 'neg-1', roleId: 'lecturer-cam', sdp: 'sdp-1' });
    expect(seen).toEqual([
      { type: 'error', negotiationId: 'neg-1', code: 'source-offline', message: expect.any(String) },
    ]);
  });

  it('answers ~300ms after an offer for an online role, then streams frames at 8 fps as sentinel-tagged ice messages', () => {
    const { w, clock } = world();
    w.apply('HL-02@lecturer-cam'); // unknown -> online
    const channel = createPreviewChannel(w);
    const seen: PreviewServerMessage[] = [];
    channel.messages$.subscribe((m) => seen.push(m));

    channel.send({ type: 'offer', negotiationId: 'neg-1', roleId: 'lecturer-cam', sdp: 'sdp-1' });
    clock.advance(299);
    expect(seen).toHaveLength(0);
    clock.advance(1);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ type: 'answer', negotiationId: 'neg-1' });

    clock.advance(1_000); // 8 fps => 8 frames in the next second
    const frames = seen.slice(1);
    expect(frames).toHaveLength(8);
    for (const f of frames) expect(isMockPreviewFrame(f)).toBe(true);
    // Frames vary — proves generateFrame's seq is actually advancing.
    const candidates = frames.map((f) => (f as { candidate: string }).candidate);
    expect(new Set(candidates).size).toBe(candidates.length);
  });

  it('a different negotiationId implicitly closes the previous one (events.md §3) rather than erroring', () => {
    const { w, clock } = world();
    w.apply('HL-02@lecturer-cam');
    const channel = createPreviewChannel(w);
    const seen: PreviewServerMessage[] = [];
    channel.messages$.subscribe((m) => seen.push(m));

    channel.send({ type: 'offer', negotiationId: 'neg-1', roleId: 'lecturer-cam', sdp: 'sdp-1' });
    clock.advance(300); // neg-1 answered and streaming
    expect(seen.filter((m) => m.type === 'answer')).toHaveLength(1);

    channel.send({ type: 'offer', negotiationId: 'neg-2', roleId: 'lecturer-cam', sdp: 'sdp-2' });
    clock.advance(300); // neg-2 answered
    const answers = seen.filter((m) => m.type === 'answer');
    expect(answers).toHaveLength(2);
    expect(answers[1]).toMatchObject({ negotiationId: 'neg-2' });
    expect(seen.some((m) => m.type === 'error')).toBe(false);

    // Only neg-2's frame loop is still running.
    const before = seen.filter((m) => isMockPreviewFrame(m)).length;
    clock.advance(125); // one 8fps tick
    const after = seen.filter((m) => isMockPreviewFrame(m)).length;
    expect(after).toBe(before + 1);
    const lastFrame = seen[seen.length - 1] as Extract<PreviewServerMessage, { type: 'ice' }>;
    expect(lastFrame.negotiationId).toBe('neg-2');
  });

  it('a superseding offer sent while the first answer is still pending cancels the first — it never answers', () => {
    const { w, clock } = world();
    w.apply('HL-02@lecturer-cam');
    const channel = createPreviewChannel(w);
    const seen: PreviewServerMessage[] = [];
    channel.messages$.subscribe((m) => seen.push(m));

    channel.send({ type: 'offer', negotiationId: 'neg-1', roleId: 'lecturer-cam', sdp: 'sdp-1' });
    clock.advance(100); // neg-1's answer is still pending (300ms delay)
    channel.send({ type: 'offer', negotiationId: 'neg-2', roleId: 'lecturer-cam', sdp: 'sdp-2' });
    clock.advance(300); // neg-1 would have answered by now if it weren't cancelled

    const answers = seen.filter((m) => m.type === 'answer');
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({ negotiationId: 'neg-2' });
  });

  it('a re-offer of the SAME open negotiationId is idempotent, never an error (error is terminal per negotiation)', () => {
    const { w, clock } = world();
    w.apply('HL-02@lecturer-cam');
    const channel = createPreviewChannel(w);
    const seen: PreviewServerMessage[] = [];
    channel.messages$.subscribe((m) => seen.push(m));

    channel.send({ type: 'offer', negotiationId: 'neg-1', roleId: 'lecturer-cam', sdp: 'sdp-1' });
    clock.advance(300); // answered, streaming
    channel.send({ type: 'offer', negotiationId: 'neg-1', roleId: 'lecturer-cam', sdp: 'sdp-1-retry' });

    expect(seen.some((m) => m.type === 'error')).toBe(false);
    // Frames for neg-1 keep flowing after the duplicate offer.
    const before = seen.filter((m) => isMockPreviewFrame(m)).length;
    clock.advance(125);
    const after = seen.filter((m) => isMockPreviewFrame(m)).length;
    expect(after).toBeGreaterThan(before);
  });

  it('close stops the frame loop and touches nothing else', () => {
    const { w, clock } = world();
    w.apply('HL-02@lecturer-cam');
    const channel = createPreviewChannel(w);
    const seen: PreviewServerMessage[] = [];
    channel.messages$.subscribe((m) => seen.push(m));

    channel.send({ type: 'offer', negotiationId: 'neg-1', roleId: 'lecturer-cam', sdp: 'sdp-1' });
    clock.advance(300);
    channel.send({ type: 'close', negotiationId: 'neg-1' });

    const countAtClose = seen.length;
    clock.advance(1_000);
    expect(seen).toHaveLength(countAtClose);
  });
});
