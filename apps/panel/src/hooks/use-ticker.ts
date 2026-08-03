import { useEffect, useState } from 'react';

/**
 * A leaf-local clock tick.
 *
 * The contract is explicit that the panel derives elapsed time locally — the
 * timer from `startedAt` + `recordedDurationMs`, the AI countdown from the
 * absolute `nextAt` — because "countdown ticks are never events per second"
 * (INV-G-7). The corollary is that a tick is not application state either: put
 * it in the store and you have replaced a 10 Hz storm with a 1 Hz one.
 *
 * Use it in the leaf that renders digits, and derive from the absolute instant:
 *
 *   useTicker(1_000);
 *   const elapsed = Date.now() - Date.parse(startedAt);
 */
export function useTicker(intervalMs: number): number {
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setTick(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return tick;
}
