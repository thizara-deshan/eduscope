import type { PanelEventName } from '@eduscope/shared';
import type { ScopedStream } from '../export/subscriptions.js';
import type { ScopedSubscriptionRegistry } from '../export/subscriptions.js';

/**
 * events.md §1 "Scoping" table: everything broadcasts to every authenticated
 * panel/admin connection except these three, which reach only the
 * `AuthSession`(s) the CG-3 REST-triggered TTL (B-16's `ScopedSubscriptionRegistry`)
 * currently marks subscribed. `audio.levels`'s "panel connections only" rule
 * needs no per-connection check here — every connection on this hub already
 * is a panel connection; its budget gate lives in `PanelHub`'s bus-refcounting
 * (design/core-api.md §6, mirroring B-09's `listenerCount` producer gate).
 */
const REQUEST_SCOPED_EVENTS: ReadonlySet<PanelEventName> = new Set<ScopedStream>(['export.job', 'usb.volumes', 'log.entry']);

/** `export.job` is scoped per job (B-16's `ExportExecutor` refreshes it keyed by `jobId`, see `worker.ts`); the other two scoped streams are flow-level with no sub-key. */
function scopeFor(event: PanelEventName, payload: unknown): string | undefined {
  if (event === 'export.job') return (payload as { jobId: string }).jobId;
  return undefined;
}

/** Whether `authSessionId`'s connection should receive this event right now. */
export function shouldDeliver(event: PanelEventName, payload: unknown, authSessionId: string, scoped: ScopedSubscriptionRegistry): boolean {
  if (!REQUEST_SCOPED_EVENTS.has(event)) return true;
  return scoped.allows(authSessionId, event as ScopedStream, scopeFor(event, payload));
}
