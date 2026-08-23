import { monotonicFactory } from 'ulidx';

/** The only ULID creation boundary — nothing else calls `ulid()`. */
export interface IdGenerator {
  next(now: Date): string;
}

export class UlidGenerator implements IdGenerator {
  readonly #factory = monotonicFactory();

  next(now: Date): string {
    return this.#factory(now.getTime());
  }
}
