import { describe, expect, it } from 'vitest';
import { isStale } from './connection.js';

describe('connection state rules', () => {
  it('is not stale while a shutdown is expected (S12-D-6)', () => {
    const stale = { phase: 'stale', attempt: 3, since: '2026-08-05T10:00:00Z' } as const;
    const closed = { phase: 'closed', attempt: 0, since: '2026-08-05T10:00:00Z' } as const;
    expect(isStale(stale, false)).toBe(true);
    expect(isStale(stale, true)).toBe(false);
    // a socket that closed with no power-off behind it is the strongest U-2 there is
    expect(isStale(closed, false)).toBe(true);
    expect(isStale(closed, true)).toBe(false);
  });
});
