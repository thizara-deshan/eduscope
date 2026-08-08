import { useQuery } from '@tanstack/react-query';
import { useClient } from '../../client/client-provider.js';

/**
 * The panel's only implementation of G-AI-ENABLED.
 * Undefined means provisioning has not resolved yet.
 */
export function useAiEnabled(): boolean | undefined {
  const client = useClient();
  const query = useQuery({
    queryKey: ['provisioning'],
    queryFn: () => client.getProvisioning(),
  });

  if (!query.data) return undefined;
  return query.data.featureFlags.aiQuizEnabled && query.data.llmEndpoint !== null;
}
