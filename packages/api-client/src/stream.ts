/** Zero-dependency push stream. No RxJS: the boundary must stay trivially mockable. */
export type Unsubscribe = () => void;

export interface EventStream<T> {
  subscribe(listener: (value: T) => void): Unsubscribe;
}

/** events.md §1 reconnect/staleness lifecycle; drives U-2 and U-3 in the panel. */
export interface ConnectionStatus {
  /** `stale` = disconnected longer than T-WS-STALE (10 s). */
  readonly phase: 'connecting' | 'open' | 'reconnecting' | 'stale' | 'closed';
  readonly attempt: number;
  readonly since: string;
  /** Set when a `seq` gap forced a full resync (events.md §1). */
  readonly resyncReason?: 'seq-gap' | 'reconnect';
}

export function createEmitter<T>(): EventStream<T> & {
  emit(value: T): void;
  size(): number;
} {
  const listeners = new Set<(value: T) => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(value) {
      for (const l of [...listeners]) l(value);
    },
    size: () => listeners.size,
  };
}
