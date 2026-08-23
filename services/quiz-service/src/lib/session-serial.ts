/**
 * Per-`quizSessionId` FIFO executor. D-02..D-07 route every mutation and
 * WS snapshot/fan-out boundary through the same key so a session's writes
 * and its snapshot stay serialized relative to each other (the one-process
 * design's substitute for a database-level serializable transaction across
 * REST + WS). Work for different keys runs fully concurrently.
 */
export interface SessionSerial {
  run<T>(quizSessionId: string, work: () => Promise<T>): Promise<T>;
}

export class InMemorySessionSerial implements SessionSerial {
  readonly #tails = new Map<string, Promise<void>>();

  run<T>(quizSessionId: string, work: () => Promise<T>): Promise<T> {
    const previousTail = this.#tails.get(quizSessionId) ?? Promise.resolve();
    const started = previousTail.then(work, work);
    const settledTail = started.then(
      () => undefined,
      () => undefined,
    );
    this.#tails.set(quizSessionId, settledTail);
    void settledTail.finally(() => {
      if (this.#tails.get(quizSessionId) === settledTail) {
        this.#tails.delete(quizSessionId);
      }
    });
    return started;
  }
}
