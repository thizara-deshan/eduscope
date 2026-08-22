/** The only asynchronous write entry point (design/core-api.md §3.1 single-writer funnel). */
export class SerialWriter {
  #tail: Promise<void> = Promise.resolve();

  run<T>(label: string, work: () => T): Promise<T> {
    const result = this.#tail.then(() => work(), () => work());
    this.#tail = result.then(() => undefined, () => undefined);
    return result.catch((error: unknown) => {
      throw new Error(`database write failed: ${label}`, { cause: error });
    });
  }
}
