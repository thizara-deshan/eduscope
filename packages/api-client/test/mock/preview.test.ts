import { describe, expect, it, vi } from 'vitest';
import type { PreviewUpdate } from '../../src/client.js';
import { createVirtualClock } from '../../src/mock/clock.js';
import { createPreviewChannel } from '../../src/mock/events/preview.js';
import { sourceMachine } from '../../src/mock/machines/health.js';
import { MockWorld } from '../../src/mock/world.js';

function world() {
  const clock = createVirtualClock('2026-07-30T09:00:00.000+00:00');
  const w = new MockWorld({ clock });
  w.registerMachine(sourceMachine('lecturer-cam'));
  return { w, clock };
}

describe('mock JPEG preview channel', () => {
  it.each([
    ['mic-room', null, 'source-unbound'],
    ['lecturer-cam', 'HL-01@lecturer-cam', 'source-unbound'],
    ['lecturer-cam', 'HL-03@lecturer-cam', 'source-offline'],
  ] as const)('reports %s as %s', (roleId, transition, code) => {
    const { w, clock } = world();
    if (transition) w.apply(transition);
    const channel = createPreviewChannel(w, roleId);
    const seen: PreviewUpdate[] = [];
    channel.updates$.subscribe((update) => seen.push(update));
    clock.advance(0);
    expect(seen).toEqual([{ kind: 'error', code, message: expect.any(String) }]);
    channel.close();
  });

  it('publishes deterministic JPEG frames once per second for an online source', () => {
    const { w, clock } = world();
    w.apply('HL-02@lecturer-cam');
    const channel = createPreviewChannel(w, 'lecturer-cam');
    const seen: PreviewUpdate[] = [];
    channel.updates$.subscribe((update) => seen.push(update));
    clock.advance(0);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ kind: 'frame', stale: false });
    expect((seen[0] as Extract<PreviewUpdate, { kind: 'frame' }>).blob.type).toBe('image/jpeg');
    clock.advance(2_000);
    expect(seen.filter((update) => update.kind === 'frame')).toHaveLength(3);
    channel.close();
  });

  it('retains the last frame, becomes stale after three seconds, and recovers', () => {
    const { w, clock } = world();
    w.apply('HL-02@lecturer-cam');
    const channel = createPreviewChannel(w, 'lecturer-cam');
    const seen: PreviewUpdate[] = [];
    channel.updates$.subscribe((update) => seen.push(update));
    clock.advance(0);
    w.apply('HL-06@lecturer-cam');
    clock.advance(3_000);
    expect(seen.at(-1)).toMatchObject({ kind: 'stale' });
    w.apply('HL-07@lecturer-cam');
    clock.advance(1_000);
    expect(seen.at(-1)).toMatchObject({ kind: 'frame', stale: false });
    channel.close();
  });

  it('close is idempotent and stops timers and subscriptions', () => {
    const { w, clock } = world();
    w.apply('HL-02@lecturer-cam');
    const onClose = vi.fn();
    const channel = createPreviewChannel(w, 'lecturer-cam', onClose);
    const seen: PreviewUpdate[] = [];
    channel.updates$.subscribe((update) => seen.push(update));
    clock.advance(0);
    channel.close();
    channel.close();
    const count = seen.length;
    clock.advance(10_000);
    expect(seen).toHaveLength(count);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
