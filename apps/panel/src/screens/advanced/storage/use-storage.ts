import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ProblemError } from '@eduscope/api-client';
import type { RegisterVolumeRequest, StorageOverview } from '@eduscope/shared';
import { useClient } from '../../../client/client-provider.js';
import { useStorageStatus } from '../../../store/selectors.js';

const STORAGE_KEY = ['storage-overview'] as const;

export interface UseStorage {
  readonly overview: StorageOverview | undefined;
  readonly loading: boolean;
  registerVolume(body: RegisterVolumeRequest): void;
  readonly registering: boolean;
  readonly registerError: string | null;
  formatVolume(volumeId: string, confirmText: string): void;
  readonly formattingId: string | null;
  readonly formatError: string | null;
  clearFormatError(): void;
}

/** S-30 — getStorageOverview merged with live storage.status pressure; register + format commands. */
export function useStorage(): UseStorage {
  const client = useClient();
  const queryClient = useQueryClient();
  const live = useStorageStatus();
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [formattingId, setFormattingId] = useState<string | null>(null);
  const [formatError, setFormatError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: STORAGE_KEY,
    queryFn: () => client.getStorageOverview(),
  });

  const registerMutation = useMutation({
    mutationFn: (body: RegisterVolumeRequest) => client.registerStorageVolume(body),
    onSuccess: () => {
      setRegisterError(null);
      void queryClient.invalidateQueries({ queryKey: STORAGE_KEY });
    },
    onError: (error: unknown) => {
      setRegisterError(error instanceof ProblemError ? error.problem.title : 'Could not register the volume.');
    },
  });

  const formatMutation = useMutation({
    mutationFn: ({ volumeId, confirmText }: { volumeId: string; confirmText: string }) =>
      client.formatStorageVolume(volumeId, { confirmText }),
    onSuccess: () => {
      setFormatError(null);
      void queryClient.invalidateQueries({ queryKey: STORAGE_KEY });
    },
    onError: (error: unknown) => {
      setFormattingId(null);
      setFormatError(error instanceof ProblemError ? error.problem.title : 'Could not format the volume.');
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: STORAGE_KEY });
    },
  });

  const overview = query.data && live
    ? { ...query.data, pressure: live.pressure, totalBytes: live.totalBytes, freeBytes: live.freeBytes }
    : query.data;

  return {
    overview,
    loading: query.isLoading,
    registerVolume: (body) => { setRegisterError(null); registerMutation.mutate(body); },
    registering: registerMutation.isPending,
    registerError,
    formatVolume: (volumeId, confirmText) => {
      setFormatError(null);
      setFormattingId(volumeId);
      formatMutation.mutate({ volumeId, confirmText });
    },
    formattingId,
    formatError,
    clearFormatError: () => setFormatError(null),
  };
}
