import { describe, expect, it } from 'vitest';
import { zAudioLevelsPayload } from '@eduscope/shared';
import { createVirtualClock } from '../../src/mock/clock.js';
import { MockWorld } from '../../src/mock/world.js';
import { generateFrame, startAudioLevels } from '../../src/mock/events/telemetry.js';

function world() {
  const clock = createVirtualClock('2026-07-30T09:00:00.000+00:00');
  return { w: new MockWorld({ clock }), clock };
}

describe('audio.levels telemetry', () => {
  it('is throttled to 10 Hz (events.md §2.6 budget)', () => {
    const { w, clock } = world();
    const seen: unknown[] = [];
    w.subscribeEvents((e) => {
      if (e.event === 'audio.levels') seen.push(e);
    });
    const stop = startAudioLevels(w, ['mic-lecturer']);
    clock.advance(1_000);
    stop();
    expect(seen).toHaveLength(10);
  });

  it('emits an rms inside the contract range on every tick', () => {
    const { w, clock } = world();
    const payloads: unknown[] = [];
    w.subscribeEvents((e) => {
      if (e.event === 'audio.levels') payloads.push(e.payload);
    });
    const stop = startAudioLevels(w, ['mic-lecturer']);
    clock.advance(2_000);
    stop();
    for (const p of payloads) expect(() => zAudioLevelsPayload.parse(p)).not.toThrow();
  });

  it('stops emitting once the last subscriber leaves', () => {
    const { w, clock } = world();
    let count = 0;
    const unsub = w.subscribeEvents((e) => {
      if (e.event === 'audio.levels') count += 1;
    });
    const stop = startAudioLevels(w, ['mic-lecturer']);
    clock.advance(500);
    const atUnsubscribe = count;
    unsub();
    clock.advance(500);
    stop();
    expect(count).toBe(atUnsubscribe);
  });
});

describe('preview frames', () => {
  it('produces a decodable JPEG data URI', () => {
    const uri = generateFrame('lecturer-cam', 0);
    expect(uri.startsWith('data:image/jpeg;base64,')).toBe(true);
    const bytes = Buffer.from(uri.slice('data:image/jpeg;base64,'.length), 'base64');
    expect(bytes.subarray(0, 2).toString('hex')).toBe('ffd8'); // SOI
    expect(bytes.subarray(-2).toString('hex')).toBe('ffd9'); // EOI
  });

  it('varies frame to frame so the UI visibly animates', () => {
    expect(generateFrame('lecturer-cam', 0)).not.toBe(generateFrame('lecturer-cam', 1));
  });
});
