import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ProblemError } from '@eduscope/api-client';
import type { FirmwareUpdate } from '@eduscope/shared';
import { useClient } from '../../../client/client-provider.js';
import { useFirmwareState } from '../../../store/selectors.js';

const FIRMWARE_KEY = ['firmware-state'] as const;

export interface UseFirmware {
  readonly firmware: FirmwareUpdate | undefined;
  readonly loading: boolean;
  check(): void;
  apply(): void;
  readonly refusedWhileRecording: string | null;
}

/** S-31 — getFirmwareState snapshot merged with live firmware.state; checkFirmware/applyFirmware (both refused while recording, 409). */
export function useFirmware(): UseFirmware {
  const client = useClient();
  const queryClient = useQueryClient();
  const [refusedWhileRecording, setRefusedWhileRecording] = useState<string | null>(null);
  const live = useFirmwareState();

  const query = useQuery({
    queryKey: FIRMWARE_KEY,
    queryFn: () => client.getFirmwareState(),
  });

  const checkMutation = useMutation({
    mutationFn: () => client.checkFirmware(),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: FIRMWARE_KEY }),
  });

  const applyMutation = useMutation({
    mutationFn: () => client.applyFirmware(),
    onSuccess: () => setRefusedWhileRecording(null),
    onError: (error: unknown) => {
      if (error instanceof ProblemError && error.problem.status === 409) {
        setRefusedWhileRecording(error.problem.title);
      }
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: FIRMWARE_KEY }),
  });

  const firmware = live ?? query.data;

  return {
    firmware,
    loading: query.isLoading,
    check: () => checkMutation.mutate(),
    apply: () => { setRefusedWhileRecording(null); applyMutation.mutate(); },
    refusedWhileRecording,
  };
}
