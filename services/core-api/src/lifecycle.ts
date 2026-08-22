export type LifecycleStopReason = 'shutdown' | 'startup-failed';

export interface LifecycleComponent {
  readonly name: string;
  start(): Promise<void>;
  stop(reason: LifecycleStopReason): Promise<void>;
}

/**
 * Owns start/stop ordering for every registered component. Starts run in
 * registration order; stops run once, in reverse registration order, so a
 * component registered first (e.g. the DB connection) closes last.
 */
export class LifecycleRegistry {
  readonly #components: LifecycleComponent[] = [];
  #started: LifecycleComponent[] = [];
  #stopPromise: Promise<void> | null = null;

  register(component: LifecycleComponent): void {
    this.#components.push(component);
  }

  async start(): Promise<void> {
    for (const component of this.#components) {
      try {
        await component.start();
      } catch (error) {
        await this.#stopStarted('startup-failed');
        throw error;
      }
      this.#started.push(component);
    }
  }

  stop(): Promise<void> {
    if (!this.#stopPromise) {
      this.#stopPromise = this.#stopStarted('shutdown');
    }
    return this.#stopPromise;
  }

  async #stopStarted(reason: LifecycleStopReason): Promise<void> {
    const toStop = [...this.#started].reverse();
    this.#started = [];
    for (const component of toStop) {
      await component.stop(reason);
    }
  }
}
