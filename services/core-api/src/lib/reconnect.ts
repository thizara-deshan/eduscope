/**
 * Stateful backoff step sequence (state-machines.md §9 `T-CONSUMER-RESTART`
 * cadence, reused here for the pm-bridge SSE reconnect per B-04's plan). The
 * last step repeats once the sequence is exhausted; `reset()` returns to the
 * first step after a successful connection.
 */
export class ReconnectBackoff {
  readonly #stepsMs: readonly number[];
  #index = 0;

  constructor(stepsMs: readonly number[]) {
    if (stepsMs.length === 0) {
      throw new Error('ReconnectBackoff requires at least one step');
    }
    this.#stepsMs = stepsMs;
  }

  next(): number {
    const step = this.#stepsMs[Math.min(this.#index, this.#stepsMs.length - 1)]!;
    this.#index += 1;
    return step;
  }

  reset(): void {
    this.#index = 0;
  }
}
