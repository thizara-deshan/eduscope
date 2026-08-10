import { useEffect, useState } from 'react';
import { ProblemError } from '@eduscope/api-client';
import type { Recording } from '@eduscope/shared';
import { useClient } from '../../client/client-provider.js';
import { useArtifactEvents, useIsStale } from '../../store/selectors.js';
import { DangerConfirm, type DangerConfirmState } from '../../danger/danger-confirm.js';
import { deleteBody } from './delete-body.js';
import { formatDuration } from './format.js';

const REFUSAL_LECTURER = "You don't have permission to delete recordings.";
const REFUSAL_GENERIC = 'This recording is no longer available.';

/**
 * S-24 — the entire screen. Everything else is the shared danger folder
 * (C-1). Chooses the body from `uploadState`, owns the `deleteRecording` 202
 * and its resolution on `recording.artifact{deleted}`.
 */
export function DeleteRecordingConfirm({
  rec,
  onDone,
}: {
  readonly rec: Recording;
  readonly onDone: () => void;
}): JSX.Element | null {
  const client = useClient();
  const stale = useIsStale();
  const artifacts = useArtifactEvents();
  const [state, setState] = useState<DangerConfirmState>('confirm');
  const [message, setMessage] = useState<string | null>(null);

  const artifact = artifacts[rec.id];
  useEffect(() => {
    if (state === 'pending' && artifact?.state === 'deleted') {
      setState('done');
      onDone();
    }
  }, [artifact, onDone, state]);

  const confirm = () => {
    setMessage(null);
    setState('pending');
    void client.deleteRecording(rec.id).catch((error: unknown) => {
      const status = error instanceof ProblemError ? error.problem.status : null;
      setMessage(status === 403 ? REFUSAL_LECTURER : REFUSAL_GENERIC);
      setState('refused');
    });
  };

  const { body, inFlight, metaTag } = deleteBody(rec);
  const durationText = rec.durationMs !== null ? formatDuration(rec.durationMs) : '—';

  return (
    <DangerConfirm
      title="Delete this recording?"
      body={(
        <>
          <p className="us-dangerconfirm__target">{rec.title}</p>
          <p className="us-dangerconfirm__target-meta">
            {rec.ownerDisplayName} · {durationText} · {metaTag}
          </p>
          <p>{body}</p>
          {inFlight ? <p>An upload in progress will be cancelled.</p> : null}
        </>
      )}
      confirmLabel="Delete"
      pendingLabel="Deleting…"
      state={state}
      message={message}
      remedy={null}
      cancelLabel={state === 'refused' ? 'Close' : 'Cancel'}
      confirmDisabled={stale}
      onCancel={onDone}
      onConfirm={confirm}
    />
  );
}
