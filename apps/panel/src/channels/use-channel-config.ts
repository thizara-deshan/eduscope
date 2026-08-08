import { useCallback, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ChannelConfig, ChannelConfigUpdate, ChannelId, Problem } from '@eduscope/shared';
import type { ChannelSnapshot } from '@eduscope/api-client';
import { useClient } from '../client/client-provider.js';
import { asProblem } from '../auth/session.js';
import { CHANNEL_QUERY_KEYS } from './channel-queries.js';

export type ChannelConfigPhase = 'idle' | 'saving' | 'applied' | 'refused';

export interface UseChannelConfig {
  readonly phase: ChannelConfigPhase;
  readonly problem: Problem | null;
  save(patch: ChannelConfigUpdate): void;
  reset(): void;
}

/** `updateChannelConfig`'s REST response replaces the matching `['channels']` row; it never writes a synthetic WS row (frontend-conventions §1). */
export function useChannelConfig(channelId: ChannelId): UseChannelConfig {
  const client = useClient();
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<ChannelConfigPhase>('idle');
  const [problem, setProblem] = useState<Problem | null>(null);

  const mutation = useMutation({
    mutationFn: (patch: ChannelConfigUpdate) => client.updateChannelConfig(channelId, patch),
    onSuccess: (config: ChannelConfig) => {
      setPhase('applied');
      setProblem(null);
      queryClient.setQueryData(
        CHANNEL_QUERY_KEYS.snapshots,
        (rows: ChannelSnapshot[] | undefined) =>
          rows?.map((row) => (row.config.channelId === channelId ? { ...row, config } : row)),
      );
    },
    onError: (error: unknown) => {
      setPhase('refused');
      setProblem(asProblem(error));
    },
  });
  const { mutate } = mutation;

  const save = useCallback((patch: ChannelConfigUpdate) => {
    setPhase('saving');
    setProblem(null);
    mutate(patch);
  }, [mutate]);

  const reset = useCallback(() => {
    setPhase('idle');
    setProblem(null);
  }, []);

  return { phase, problem, save, reset };
}
