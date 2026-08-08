import { useCallback, useEffect, useRef, useState } from 'react';
import { TIMERS } from '@eduscope/shared';
import type { ChannelId, Problem } from '@eduscope/shared';
import { useClient } from '../client/client-provider.js';
import { asProblem } from '../auth/session.js';
import { useChannelStatus, useIsStale } from '../store/selectors.js';

/** A ceiling timeout carries no server Problem code — it never reached one. */
export type ChannelCommandProblem = Problem | { readonly status: 0; readonly code: 'unresolved'; readonly title: string };

export interface UseChannelRuntimeCommand {
  /** true from the moment a command is issued until `channel.state` reaches a stable terminal state or the ceiling expires. Never implies `checked`. */
  readonly pending: boolean;
  readonly problem: ChannelCommandProblem | null;
  requestEnabled(enabled: boolean): void;
}

const STABLE_STATES = new Set(['on', 'off', 'failed']);

/** 202 enable/disable — SM-R-2 does not apply (CH-01/02/04), so `pending` resolves only from a real `channel.state` transition or `T-CMD-RESOLVE`, never a client-side timer standing in for one. */
export function useChannelRuntimeCommand(channelId: ChannelId): UseChannelRuntimeCommand {
  const client = useClient();
  const status = useChannelStatus(channelId);
  const stale = useIsStale();
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<ChannelCommandProblem | null>(null);
  const issuedFrom = useRef<string | null>(null);
  const ceiling = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCeiling = useCallback(() => {
    if (ceiling.current !== null) clearTimeout(ceiling.current);
    ceiling.current = null;
  }, []);

  useEffect(() => clearCeiling, [clearCeiling]);

  useEffect(() => {
    if (!pending || !status || status.state === issuedFrom.current) return;
    if (STABLE_STATES.has(status.state)) {
      clearCeiling();
      setPending(false);
    }
  }, [clearCeiling, pending, status]);

  const requestEnabled = useCallback((enabled: boolean) => {
    if (pending || stale) return;
    issuedFrom.current = status?.state ?? null;
    setPending(true);
    setProblem(null);
    clearCeiling();
    ceiling.current = setTimeout(() => {
      ceiling.current = null;
      setPending(false);
      setProblem({ status: 0, code: 'unresolved', title: 'This did not resolve in time.' });
    }, TIMERS['T-CMD-RESOLVE']);

    const request = enabled ? client.enableChannel(channelId) : client.disableChannel(channelId);
    void request.catch((error: unknown) => {
      clearCeiling();
      setPending(false);
      setProblem(asProblem(error));
    });
  }, [channelId, clearCeiling, client, pending, stale, status?.state]);

  return { pending, problem, requestEnabled };
}
