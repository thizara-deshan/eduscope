export interface Clock {
  now(): number;
  nowIso(): string;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(handle: number): void;
}

export function createWallClock(): Clock {
  return {
    now: () => Date.now(),
    nowIso: () => new Date().toISOString().replace('Z', '+00:00'),
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms) as unknown as number,
    clearTimeout: (h) => {
      globalThis.clearTimeout(h);
    },
  };
}

export interface VirtualClock extends Clock {
  /** Advance time and run everything that comes due, in scheduled order. */
  advance(ms: number): void;
}

/** Deterministic clock for tests — no real timers, so suites never sleep. */
export function createVirtualClock(startIso: string): VirtualClock {
  let t = Date.parse(startIso);
  let nextHandle = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();

  return {
    now: () => t,
    nowIso: () => new Date(t).toISOString().replace('Z', '+00:00'),
    setTimeout(fn, ms) {
      const handle = nextHandle++;
      pending.set(handle, { at: t + ms, fn });
      return handle;
    },
    clearTimeout(handle) {
      pending.delete(handle);
    },
    advance(ms) {
      const target = t + ms;
      for (;;) {
        const due = [...pending.entries()]
          .filter(([, v]) => v.at <= target)
          .sort((a, b) => a[1].at - b[1].at);
        const next = due[0];
        if (!next) break;
        pending.delete(next[0]);
        t = next[1].at;
        next[1].fn();
      }
      t = target;
    },
  };
}
