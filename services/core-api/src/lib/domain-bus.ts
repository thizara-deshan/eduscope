import type { AudioControlPayload, AudioLevelsPayload, ChannelStatePayload, RecordingSegmentPayload, RecordingStatePayload, SourcesStatusPayload } from '@eduscope/shared';
import type { PmStatus } from '../modules/recording/pm/types.js';

/**
 * The in-process typed event bus modules publish domain transitions to and
 * the WS hub (and other machines) subscribe from (design/core-api.md §1,
 * "Module dependency rule"). No module calls another module's route handler
 * directly — this bus, plus the DB, is the only cross-module channel.
 *
 * Event names reuse the `evt.pm.*` vocabulary from state-machines.md verbatim
 * so a transition table row and a `subscribe()` call cite the same string.
 */
export interface CoreDomainEvents {
  'evt.pm.consumer.running': { consumerId: string; pgid: number | null };
  'evt.pm.consumer.failed': { consumerId: string; code: string; meta?: Record<string, unknown> };
  'evt.pm.consumer.eos': { consumerId: string };
  'evt.pm.consumer.exited': { consumerId: string; code: string };
  'pm.status.resynced': PmStatus;
  /** Public panel/admin events (contracts/events.md §2) — published here after their owning DB transaction commits; B-35's WS hub fans these out. */
  'recording.state': RecordingStatePayload;
  'recording.segment': RecordingSegmentPayload;
  'channel.state': ChannelStatePayload;
  'sources.status': SourcesStatusPayload;
  'audio.levels': AudioLevelsPayload;
  'audio.control': AudioControlPayload;
}

export type DomainEventType = keyof CoreDomainEvents;

type Listener<K extends DomainEventType> = (payload: CoreDomainEvents[K]) => void;

/** Unsubscribes the listener it was returned from `subscribe()` for. */
export type Unsubscribe = () => void;

export class DomainBus {
  readonly #listeners = new Map<DomainEventType, Set<Listener<DomainEventType>>>();

  publish<K extends DomainEventType>(type: K, payload: CoreDomainEvents[K]): void {
    const listeners = this.#listeners.get(type);
    if (!listeners) return;
    for (const listener of [...listeners]) {
      (listener as Listener<K>)(payload);
    }
  }

  subscribe<K extends DomainEventType>(type: K, listener: Listener<K>): Unsubscribe {
    let listeners = this.#listeners.get(type);
    if (!listeners) {
      listeners = new Set();
      this.#listeners.set(type, listeners);
    }
    listeners.add(listener as Listener<DomainEventType>);
    return () => {
      listeners.delete(listener as Listener<DomainEventType>);
    };
  }

  /** §6 budget gate (e.g. `audio.levels`, INV-G-7): lets a producer skip work entirely while nothing is subscribed. */
  listenerCount(type: DomainEventType): number {
    return this.#listeners.get(type)?.size ?? 0;
  }
}
