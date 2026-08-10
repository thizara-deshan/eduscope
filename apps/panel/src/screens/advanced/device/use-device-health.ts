import { useQuery } from '@tanstack/react-query';
import type { DeviceHealth } from '@eduscope/shared';
import { TIMERS } from '@eduscope/shared';
import { useClient } from '../../../client/client-provider.js';
import { useTicker } from '../../../hooks/use-ticker.js';
import { useDeviceHealth as useLiveDeviceHealth, useIsStale } from '../../../store/selectors.js';
import { DEVICE_KEYS } from './query-keys.js';

export interface UseDeviceHealth {
  readonly health: DeviceHealth | undefined;
  readonly loading: boolean;
  /** C-3: arrival-time staleness — a connection stall OR no device.health for T-HEALTH-STALE. */
  readonly isStale: boolean;
}

export function useDeviceHealth(): UseDeviceHealth {
  const client = useClient();
  const query = useQuery({
    queryKey: DEVICE_KEYS.health,
    queryFn: () => client.getDeviceHealth(),
  });
  const { health: live, healthAt } = useLiveDeviceHealth();
  const wsStale = useIsStale();
  const now = useTicker(1_000);

  const healthStale = healthAt !== null && now - healthAt > TIMERS['T-HEALTH-STALE'];
  const isStale = wsStale || healthStale;

  const health = query.data && live ? { ...query.data, ...live } : query.data;

  return { health, loading: query.isLoading, isStale };
}
