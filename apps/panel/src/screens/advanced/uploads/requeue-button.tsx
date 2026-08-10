import { useEffect, useRef, useState } from 'react';
import { TIMERS } from '@eduscope/shared';
import { ProblemError } from '@eduscope/api-client';
import type { UploadJob } from '@eduscope/shared';
import { useClient } from '../../../client/client-provider.js';
import { useUploadJobEvents } from '../../../store/selectors.js';
import './uploads.css';

/** S-35 §5.1 — dead-letter only; owns the `requeueUploadJob` 202, resolves on `upload.job{queued}`; `409` -> U-5 named reason, never re-tappable. `--accent`: recovery, not `--danger`. */
export function RequeueButton({ job }: { readonly job: UploadJob }): JSX.Element {
  const client = useClient();
  const jobEvents = useUploadJobEvents();
  const [pending, setPending] = useState(false);
  const [refusalReason, setRefusalReason] = useState<string | null>(null);
  const ceiling = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCeiling = () => {
    if (ceiling.current !== null) clearTimeout(ceiling.current);
    ceiling.current = null;
  };
  useEffect(() => clearCeiling, []);

  const live = jobEvents[job.recordingId];
  useEffect(() => {
    if (pending && live?.jobId === job.id && live.state === 'queued') {
      clearCeiling();
      setPending(false);
    }
  }, [pending, live, job.id]);

  if (refusalReason) {
    return <p className="us-uploadrow__refused">{refusalReason}</p>;
  }

  const requeue = () => {
    setPending(true);
    clearCeiling();
    ceiling.current = setTimeout(() => {
      ceiling.current = null;
      setPending(false);
    }, TIMERS['T-CMD-RESOLVE']);
    void client.requeueUploadJob(job.id).catch((error: unknown) => {
      clearCeiling();
      setPending(false);
      setRefusalReason(error instanceof ProblemError ? (error.problem.detail ?? error.problem.title) : 'Could not requeue.');
    });
  };

  return (
    <button type="button" className="us-uploadrow__requeue" disabled={pending} onClick={requeue}>
      {pending ? 'Requeuing…' : 'Try again now'}
    </button>
  );
}
