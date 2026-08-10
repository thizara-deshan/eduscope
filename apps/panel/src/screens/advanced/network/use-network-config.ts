import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NetworkConfig, NetworkConfigUpdate } from '@eduscope/shared';
import { useClient } from '../../../client/client-provider.js';

const NETWORK_KEY = ['network-configs'] as const;

export interface UseNetworkConfig {
  readonly configs: NetworkConfig[] | undefined;
  readonly loading: boolean;
  apply(id: string, patch: NetworkConfigUpdate): void;
  readonly applyingId: string | null;
}

/**
 * `updateNetworkConfig` is 202-async, but there is no `network.apply` WS event
 * (C-5) — the row itself carries `appliedAt`/`lastApplyError`, so the UI
 * reacts by re-reading it after the command resolves, not by waiting on a
 * push.
 */
export function useNetworkConfig(): UseNetworkConfig {
  const client = useClient();
  const queryClient = useQueryClient();
  const [applyingId, setApplyingId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: NETWORK_KEY,
    queryFn: () => client.listNetworkConfigs(),
  });

  const mutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: NetworkConfigUpdate }) =>
      client.updateNetworkConfig(id, patch),
    onSettled: () => {
      setApplyingId(null);
      void queryClient.invalidateQueries({ queryKey: NETWORK_KEY });
    },
  });

  const apply = (id: string, patch: NetworkConfigUpdate) => {
    setApplyingId(id);
    mutation.mutate({ id, patch });
  };

  return { configs: query.data, loading: query.isLoading, apply, applyingId };
}
