import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SystemAlert } from '@eduscope/shared';
import { useClient } from '../../../client/client-provider.js';
import { asProblem } from '../../../auth/session.js';
import { useAlertsList } from '../../../store/selectors.js';
import { DEVICE_KEYS } from './query-keys.js';

export interface UseAlerts {
  readonly alerts: SystemAlert[];
  readonly loading: boolean;
  acknowledge(id: string): void;
  readonly ackPending: string | null;
  /** The alert id a 404/refusal applies to, and its message (U-5). */
  readonly ackError: { readonly id: string; readonly message: string } | null;
}

/**
 * `acknowledgeAlert` is a plain synchronous REST call (mock/rest/device.ts) —
 * it returns the updated row directly, unlike the 202 commands elsewhere in
 * this wave; there is no `system.alert` echo to wait on, so the mutation's
 * own settle IS the resolution.
 */
export function useAlerts({ includeCleared }: { includeCleared: boolean }): UseAlerts {
  const client = useClient();
  const queryClient = useQueryClient();
  const [ackPending, setAckPending] = useState<string | null>(null);
  const [ackError, setAckError] = useState<{ id: string; message: string } | null>(null);

  const query = useQuery({
    queryKey: DEVICE_KEYS.alerts(includeCleared),
    queryFn: () => client.listAlerts({ includeCleared }),
  });
  const live = useAlertsList();
  // `acknowledgeAlert` has no `system.alert` echo (see the mutation below), so
  // a live replay of the ORIGINAL (unacknowledged) row would otherwise
  // clobber a just-completed acknowledge on every re-render — this override
  // wins until the alert itself clears.
  const [ackOverrides, setAckOverrides] = useState<Record<string, SystemAlert>>({});

  const mutation = useMutation({
    mutationFn: (id: string) => client.acknowledgeAlert(id),
    onSuccess: (updated) => {
      setAckPending(null);
      // The response IS the truth (a plain synchronous REST call, no echo to
      // wait on) — write it straight into the cache rather than relying on a
      // refetch to reflect a seed mutation that already happened server-side.
      queryClient.setQueryData(
        DEVICE_KEYS.alerts(includeCleared),
        (old: { items: SystemAlert[] } | undefined) => old && {
          items: old.items.map((a) => (a.id === updated.id ? updated : a)),
        },
      );
      setAckOverrides((o) => ({ ...o, [updated.id]: updated }));
    },
    onError: (error: unknown, id) => {
      setAckPending(null);
      const problem = asProblem(error);
      setAckError({ id, message: problem?.title ?? 'Could not acknowledge this alert.' });
    },
  });

  const acknowledge = (id: string) => {
    setAckError(null);
    setAckPending(id);
    mutation.mutate(id);
  };

  // REST snapshot is the base; a live system.alert (e.g. a fresh raise/re-raise)
  // overlays by id — INV-SA-1 re-raises still merge into the same row. A local
  // acknowledge override applies LAST: a re-raise (new raisedAt) clears it
  // naturally since the live row's identity has moved on, but a stale replay
  // of the same unacknowledged row can't undo an acknowledge that already landed.
  const alerts = useMemo(() => {
    const byId = new Map((query.data?.items ?? []).map((a) => [a.id, a] as const));
    for (const a of live) {
      if (includeCleared || a.clearedAt === null) byId.set(a.id, a);
    }
    for (const [id, override] of Object.entries(ackOverrides)) {
      const current = byId.get(id);
      if (current && current.raisedAt === override.raisedAt && current.clearedAt === null) {
        byId.set(id, override);
      }
    }
    return [...byId.values()];
  }, [query.data, live, includeCleared, ackOverrides]);

  return { alerts, loading: query.isLoading, acknowledge, ackPending, ackError };
}
