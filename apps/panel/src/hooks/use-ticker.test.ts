import { renderHook } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTicker } from './use-ticker.js';
import { useWsStore } from '../store/ws-store.js';

describe('useTicker', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('ticks locally and never touches shared state (INV-G-7)', () => {
    let storeNotifications = 0;
    const unsub = useWsStore.subscribe(() => { storeNotifications += 1; });
    const { result } = renderHook(() => useTicker(1_000));
    const first = result.current;
    // The interval callback's setTick must be flushed inside act(), or
    // result.current still reads the pre-timer value.
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(result.current).toBeGreaterThan(first);
    unsub();
    expect(storeNotifications, 'a tick is not application state').toBe(0);
  });
});
