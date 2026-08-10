import { useQuery } from '@tanstack/react-query';
import type { DeviceProvisioning } from '@eduscope/shared';
import { useClient } from '../../../client/client-provider.js';
import { DEVICE_KEYS } from './query-keys.js';

/**
 * The G-PROVISIONED derivation (S-36-design §2.2): human labels of any
 * required field that is missing. Distinct from `shell/use-provisioning.ts`
 * (S-03's header + session-revocation detector, `retry: false`) — this hook
 * returns the full row for the admin status sheet and must not share that
 * retry behaviour.
 */
const REQUIRED_FIELD_LABELS: Record<'hallCode' | 'expectedStorageVolumeUuid', string> = {
  hallCode: 'Hall code',
  expectedStorageVolumeUuid: 'Expected storage volume',
};

export interface UseProvisioning {
  readonly provisioning: DeviceProvisioning | undefined;
  readonly loading: boolean;
  readonly missingFields: string[];
}

export function useProvisioning(): UseProvisioning {
  const client = useClient();
  const query = useQuery({
    queryKey: DEVICE_KEYS.provisioning,
    queryFn: () => client.getProvisioning(),
  });

  const missingFields = query.data
    ? (Object.keys(REQUIRED_FIELD_LABELS) as Array<keyof typeof REQUIRED_FIELD_LABELS>)
      .filter((field) => !query.data[field])
      .map((field) => REQUIRED_FIELD_LABELS[field])
    : [];

  return { provisioning: query.data, loading: query.isLoading, missingFields };
}
