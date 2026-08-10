import { useCallback, useEffect, useRef, useState } from 'react';
import { TIMERS } from '@eduscope/shared';
import { ProblemError } from '@eduscope/api-client';
import type { Recording } from '@eduscope/shared';
import { useAuth } from '../../../auth/auth-context.js';
import { useClient } from '../../../client/client-provider.js';
import { useArtifactEvents } from '../../../store/selectors.js';
import './detail.css';

/**
 * S-22 §2.4/CG-7 — admin-only Retry on a `merge failed` recording (RA-07,
 * U-6). Resolves on `recording.artifact{merging}`, never on the 202 alone
 * (U-4, ceiling T-CMD-RESOLVE). `--accent`: this is a recovery, never
 * `--danger` (DTL-D-3).
 */
export function RetryMerge({ recordingId }: { readonly recordingId: Recording['id'] }): JSX.Element | null {
  const { role } = useAuth();
  const client = useClient();
  const artifacts = useArtifactEvents();
  const [pending, setPending] = useState(false);
  const [refusalReason, setRefusalReason] = useState<string | null>(null);
  const ceiling = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCeiling = useCallback(() => {
    if (ceiling.current !== null) clearTimeout(ceiling.current);
    ceiling.current = null;
  }, []);
  useEffect(() => clearCeiling, [clearCeiling]);

  useEffect(() => {
    if (!pending) return;
    const artifact = artifacts[recordingId];
    if (artifact?.state === 'merging') {
      clearCeiling();
      setPending(false);
    }
  }, [pending, artifacts, recordingId, clearCeiling]);

  if (role !== 'admin') return null;

  const retry = () => {
    setPending(true);
    setRefusalReason(null);
    clearCeiling();
    ceiling.current = setTimeout(() => {
      ceiling.current = null;
      setPending(false);
    }, TIMERS['T-CMD-RESOLVE']);
    void client.retryMergeRecording(recordingId).catch((error: unknown) => {
      clearCeiling();
      setPending(false);
      setRefusalReason(error instanceof ProblemError ? (error.problem.detail ?? error.problem.title) : 'Could not retry.');
    });
  };

  if (refusalReason) {
    return <p className="us-detail__retry-refused">{refusalReason}</p>;
  }

  return (
    <button type="button" className="us-detail__retry" disabled={pending} onClick={retry}>
      {pending ? 'Retrying…' : 'Retry preparing'}
    </button>
  );
}
