/**
 * The only seams through which application code reads wall time or schedules
 * work. Callers never use `Date.now()`/`setTimeout()`/`setInterval()` directly
 * so tests can inject `FakeClock` and drive time deterministically.
 */
export interface Cancel {
  cancel(): void;
}

export interface Clock {
  now(): Date;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  every(ms: number, run: () => void): Cancel;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }

  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  every(ms: number, run: () => void): Cancel {
    const timer = setInterval(run, ms);
    return { cancel: () => clearInterval(timer) };
  }
}
