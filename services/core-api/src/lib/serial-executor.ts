/**
 * The per-machine command queue (design/core-api.md §2 "command executor",
 * §3.1 "per-machine serial executors"). Route handlers enqueue accepted
 * commands here; PM-event handlers and timer callbacks re-enter the same
 * queue for their own follow-up writes, so a machine's state is always
 * touched by one command at a time, in submission order — never a second
 * writer racing the first (SM-R-1).
 *
 * Unlike `SerialWriter` (a synchronous `better-sqlite3` write funnel), work
 * here may `await` between reading guard state and writing it — the ordering
 * guarantee is what matters, not single-turn atomicity.
 */
export class SerialExecutor {
  #tail: Promise<unknown> = Promise.resolve();

  /** Queues `work` behind everything already queued; its own failure never blocks what runs after it. Errors propagate to the caller unchanged (route handlers depend on `instanceof ProblemError`). */
  run<T>(work: () => Promise<T> | T): Promise<T> {
    const result = this.#tail.then(work, work);
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
