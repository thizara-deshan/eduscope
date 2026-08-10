import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UserImportBatch } from '@eduscope/shared';
import { useClient } from '../../../../client/client-provider.js';

export interface UseImport {
  readonly batch: UserImportBatch | null;
  readonly uploading: boolean;
  upload(file: File): void;
  reset(): void;
}

/** S-33 — importUsers({file}); the response IS the verdict (synchronous, no 202). */
export function useImport(): UseImport {
  const client = useClient();
  const queryClient = useQueryClient();
  const [batch, setBatch] = useState<UserImportBatch | null>(null);

  const mutation = useMutation({
    mutationFn: (file: File) => client.importUsers({ file }),
    onSuccess: (result) => {
      setBatch(result);
      if (result.state === 'applied') void queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });

  return {
    batch,
    uploading: mutation.isPending,
    upload: (file) => mutation.mutate(file),
    reset: () => setBatch(null),
  };
}
