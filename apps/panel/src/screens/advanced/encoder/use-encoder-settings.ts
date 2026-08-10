import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EncoderCapabilities, EncodingProfile, EncodingProfileUpdate } from '@eduscope/shared';
import { ProblemError } from '@eduscope/api-client';
import { useClient } from '../../../client/client-provider.js';

const ENCODER_KEY = ['encoder-settings'] as const;

export interface UseEncoderSettings {
  readonly profile: EncodingProfile | undefined;
  readonly capabilities: EncoderCapabilities | undefined;
  readonly loading: boolean;
  save(patch: EncodingProfileUpdate): void;
  readonly saving: boolean;
  /** The offending field name on a 422 (B-56 — a value outside `capabilities`). */
  readonly rejectedField: string | null;
}

const FIELD_ORDER: (keyof EncodingProfileUpdate)[] = [
  'videoBitrateKbps', 'framerate', 'gop', 'rateControl', 'audioBitrateKbps',
];

export function useEncoderSettings(): UseEncoderSettings {
  const client = useClient();
  const queryClient = useQueryClient();
  const [rejectedField, setRejectedField] = useState<string | null>(null);
  const [lastPatch, setLastPatch] = useState<EncodingProfileUpdate | null>(null);

  const query = useQuery({
    queryKey: ENCODER_KEY,
    queryFn: () => client.getEncoderSettings(),
  });

  const mutation = useMutation({
    mutationFn: (patch: EncodingProfileUpdate) => client.updateEncoderSettings(patch),
    onSuccess: () => {
      setRejectedField(null);
      void queryClient.invalidateQueries({ queryKey: ENCODER_KEY });
    },
    onError: (error: unknown) => {
      // The mock's 422 names the offending field only in prose; the request body
      // itself tells us which field the operator was changing, so attribute the
      // rejection to the field that was actually touched.
      if (error instanceof ProblemError && error.problem.status === 422) {
        const field = lastPatch ? FIELD_ORDER.find((f) => f in lastPatch) : undefined;
        setRejectedField(field ?? null);
      }
    },
  });

  const save = (patch: EncodingProfileUpdate) => {
    setLastPatch(patch);
    setRejectedField(null);
    mutation.mutate(patch);
  };

  return {
    profile: query.data?.profile,
    capabilities: query.data?.capabilities,
    loading: query.isLoading,
    save,
    saving: mutation.isPending,
    rejectedField,
  };
}
