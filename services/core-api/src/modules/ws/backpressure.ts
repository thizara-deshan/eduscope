/** events.md-adjacent hub budget: a connection this far behind is dropped, not queued (B-35 step 1). */
export const MAX_QUEUED_EVENTS = 256;
export const MAX_QUEUED_BYTES = 1024 * 1024;

/**
 * Per-connection outbound queue depth/byte tracker. `PanelHub` calls
 * `wouldExceed` before writing; the slow socket is closed instead of buffered
 * further (clients resync via the full snapshot, never server replay).
 */
export class BackpressureTracker {
  #queued = 0;
  #bytes = 0;

  get queued(): number {
    return this.#queued;
  }

  get bytes(): number {
    return this.#bytes;
  }

  wouldExceed(byteLength: number): boolean {
    return this.#queued + 1 > MAX_QUEUED_EVENTS || this.#bytes + byteLength > MAX_QUEUED_BYTES;
  }

  enqueue(byteLength: number): void {
    this.#queued += 1;
    this.#bytes += byteLength;
  }

  dequeue(byteLength: number): void {
    this.#queued = Math.max(0, this.#queued - 1);
    this.#bytes = Math.max(0, this.#bytes - byteLength);
  }
}
