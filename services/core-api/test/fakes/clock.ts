import type { Cancel, Clock } from '../../src/lib/clock.js';

interface ScheduledSleep {
  readonly dueAt: number;
  resolve: () => void;
}

interface ScheduledInterval {
  readonly periodMs: number;
  nextDueAt: number;
  readonly run: () => void;
  cancelled: boolean;
}

/**
 * Deterministic Clock for tests: time only moves when `advance()` is called,
 * and sleeps/intervals due within the advanced window fire in due-time order.
 */
export class FakeClock implements Clock {
  #nowMs: number;
  #sleeps: ScheduledSleep[] = [];
  #intervals: ScheduledInterval[] = [];

  constructor(initial: Date = new Date('2026-01-01T00:00:00.000Z')) {
    this.#nowMs = initial.getTime();
  }

  now(): Date {
    return new Date(this.#nowMs);
  }

  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const entry: ScheduledSleep = { dueAt: this.#nowMs + ms, resolve };
      this.#sleeps.push(entry);
      signal?.addEventListener(
        'abort',
        () => {
          const index = this.#sleeps.indexOf(entry);
          if (index !== -1) {
            this.#sleeps.splice(index, 1);
          }
          resolve();
        },
        { once: true },
      );
    });
  }

  every(ms: number, run: () => void): Cancel {
    const entry: ScheduledInterval = { periodMs: ms, nextDueAt: this.#nowMs + ms, run, cancelled: false };
    this.#intervals.push(entry);
    return {
      cancel: () => {
        entry.cancelled = true;
      },
    };
  }

  /** Advances virtual time by `ms`, firing due sleeps/intervals in chronological order. */
  advance(ms: number): void {
    const target = this.#nowMs + ms;

    for (;;) {
      const dueSleep = this.#sleeps.reduce<ScheduledSleep | null>(
        (min, entry) => (min === null || entry.dueAt < min.dueAt ? entry : min),
        null,
      );
      const dueInterval = this.#intervals
        .filter((entry) => !entry.cancelled)
        .reduce<ScheduledInterval | null>(
          (min, entry) => (min === null || entry.nextDueAt < min.nextDueAt ? entry : min),
          null,
        );

      const candidates = [dueSleep?.dueAt, dueInterval?.nextDueAt].filter(
        (at): at is number => at !== undefined && at <= target,
      );
      if (candidates.length === 0) break;

      const dueAt = Math.min(...candidates);
      this.#nowMs = dueAt;

      if (dueSleep && dueSleep.dueAt === dueAt) {
        this.#sleeps.splice(this.#sleeps.indexOf(dueSleep), 1);
        dueSleep.resolve();
      }
      if (dueInterval && dueInterval.nextDueAt === dueAt) {
        dueInterval.nextDueAt += dueInterval.periodMs;
        dueInterval.run();
      }
    }

    this.#nowMs = target;
  }
}
