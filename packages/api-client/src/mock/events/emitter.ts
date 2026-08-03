import type { EventEnvelope } from '@eduscope/shared';
import { createEmitter, type EventStream, type Unsubscribe } from '../../stream.js';
import type { MockWorld } from '../world.js';

/**
 * The CONNECTION-level envelope stream: envelope forwarding, `seq` stamping and
 * on-subscribe snapshot replay (events.md §1).
 *
 * Distinct from `MockWorld`'s own emitter, which is WORLD-level. The world is
 * rebuilt from scratch on every `switchScenario`, and its internal `seq` restarts
 * with it; `seq` is contractually "monotonic per connection", and the connection
 * survives a scenario switch. This module owns that outer counter so a subscriber
 * that attached before a switch never observes `seq` going backwards.
 */
export interface EnvelopeStream {
  /** The stable, connection-lifetime stream handed to consumers. */
  readonly events$: EventStream<EventEnvelope>;
  /** Forward a freshly built world's events onto the connection. Returns its teardown. */
  attach(world: MockWorld): Unsubscribe;
  /** events.md §1: a seq gap forces a full snapshot re-request, never a patch. */
  replay(world: MockWorld): void;
}

/**
 * `world.snapshot()` returns `latest`'s values in Map iteration order, which is
 * INSERTION order — a `Map.set()` on an already-present key updates the value but
 * does not move its position. Seeding writes the same discriminated key (e.g.
 * `sources.status:presentation`) more than once before the first subscriber ever
 * attaches, so replaying raw Map order does not reliably track `seq` order.
 * Sort explicitly rather than depend on Map ordering incidentally matching.
 */
export function snapshotInSeqOrder(world: MockWorld): EventEnvelope[] {
  return [...world.snapshot()].sort((a, b) => a.seq - b.seq);
}

export function createEnvelopeStream(currentWorld: () => MockWorld): EnvelopeStream {
  const outward = createEmitter<EventEnvelope>();
  let seq = 0;
  const stamp = (e: EventEnvelope): EventEnvelope => ({ ...e, seq: seq++ });

  return {
    events$: {
      subscribe(listener) {
        // The on-subscribe snapshot replays the world's OWN seq values: it is a
        // point-in-time description of current state, and the store keys its gap
        // detection off the live stream that follows. Re-stamping here would burn
        // connection seq numbers on events the client is not being asked to
        // sequence. `replay()` below is the opposite case — it emits onto the live
        // stream, so it must stamp.
        for (const e of snapshotInSeqOrder(currentWorld())) listener(e);
        return outward.subscribe(listener);
      },
    },

    attach(world) {
      return world.subscribeEvents((e) => outward.emit(stamp(e)));
    },

    replay(world) {
      for (const e of snapshotInSeqOrder(world)) outward.emit(stamp(e));
    },
  };
}
