import type { ConnectionStatus } from '@eduscope/api-client';
import type { EventEnvelope } from '@eduscope/shared';

/**
 * The two connection rules the WS store applies, kept as pure predicates so they
 * can be reasoned about (and tested) without standing up a store.
 *
 * They are rules, not state: `ws-store.ts` owns the slices, this file owns what
 * the slices mean.
 */

/**
 * U-2 — disconnected longer than `T-WS-STALE`: dim the live regions.
 *
 * Note what this deliberately does NOT do: clear the recording slice. The device
 * is still recording whether or not the panel can see it, and blanking the frame
 * would be the more dangerous lie of the two.
 */
export const isStale = (status: ConnectionStatus): boolean => status.phase === 'stale';

/**
 * U-3 — a gap in `seq` means events were missed.
 *
 * events.md §1: the recovery is a full snapshot re-request, never a patch, so
 * this only has to detect the gap. `lastSeq === null` is the first event on a
 * connection and can never be a gap.
 */
export const hasSeqGap = (lastSeq: number | null, envelope: EventEnvelope): boolean =>
  lastSeq !== null && envelope.seq > lastSeq + 1;
