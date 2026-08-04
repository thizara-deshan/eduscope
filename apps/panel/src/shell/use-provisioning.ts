import { useQuery } from '@tanstack/react-query';
import { useClient } from '../client/client-provider.js';
import { useSessionRevocation } from '../auth/use-session-revocation.js';

/**
 * S-03's first authenticated read (W1-D-6): a revoked session surfaces here
 * first, since there is no token-refresh loop yet in Wave 1. Renders nothing
 * (not a placeholder) while loading — U-1's "never layout shift".
 */
export function useProvisioning(): { hallDisplayName: string | null } {
  const client = useClient();
  const query = useQuery({
    queryKey: ['provisioning'],
    queryFn: () => client.getProvisioning(),
  });
  useSessionRevocation(query.error);
  return { hallDisplayName: query.data?.hallDisplayName ?? null };
}
