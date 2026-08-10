import { useState } from 'react';
import { ProblemError } from '@eduscope/api-client';
import { useClient } from '../../../client/client-provider.js';
import type { LogFilter } from './use-logs.js';

export type ExportState = 'idle' | 'exporting' | 'ready' | 'failed';

export interface UseLogExport {
  readonly state: ExportState;
  readonly error: string | null;
  exportCsv(filter: LogFilter): void;
}

/** S-34 — Blob + object URL download from exportLogsCsv's returned string. No hand-assembled URL (boundary rule). */
export function useLogExport(): UseLogExport {
  const client = useClient();
  const [state, setState] = useState<ExportState>('idle');
  const [error, setError] = useState<string | null>(null);

  const exportCsv = (filter: LogFilter) => {
    setState('exporting');
    setError(null);
    client.exportLogsCsv(filter).then((csv) => {
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'logs.csv';
      anchor.click();
      URL.revokeObjectURL(url);
      setState('ready');
    }).catch((err: unknown) => {
      setState('failed');
      setError(err instanceof ProblemError ? err.problem.title : 'Could not export the logs.');
    });
  };

  return { state, error, exportCsv };
}
