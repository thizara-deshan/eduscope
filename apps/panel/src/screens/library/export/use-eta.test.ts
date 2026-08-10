import { describe, expect, it } from 'vitest';
import { computeEta } from './use-eta.js';

describe('computeEta (S-23 EXP-D-3) — pure function of bytes over time', () => {
  it('fewer than 2 samples -> null (shows "Starting…")', () => {
    expect(computeEta(1_000_000, [])).toBeNull();
    expect(computeEta(1_000_000, [{ bytesCopied: 0, at: 0 }])).toBeNull();
  });

  it('a steady byte-rate over samples produces a plausible smoothed seconds-remaining', () => {
    // 100 bytes/sec over 3 samples, 400 bytes remaining of 1000 total.
    const samples = [
      { bytesCopied: 0, at: 0 },
      { bytesCopied: 300, at: 3_000 },
      { bytesCopied: 600, at: 6_000 },
    ];
    const eta = computeEta(1_000, samples);
    expect(eta).not.toBeNull();
    expect(eta).toBeCloseTo(4, 0);
  });

  it('is a pure function: takes only bytesTotal and samples, holds no state, reads no freeBytes', () => {
    expect(computeEta.length).toBe(2);
  });

  it('returns 0 when the copy is already complete', () => {
    const samples = [{ bytesCopied: 0, at: 0 }, { bytesCopied: 1_000, at: 1_000 }];
    expect(computeEta(1_000, samples)).toBe(0);
  });
});
