import { useEffect, useState } from 'react';
import { ProblemError } from '@eduscope/api-client';
import { DangerConfirm, type DangerConfirmState } from '../../danger/danger-confirm.js';
import { useAuth } from '../../auth/auth-context.js';
import { useClient } from '../../client/client-provider.js';
import { useRecordingSession } from '../../store/selectors.js';

const NOT_ADMIN_COPY = 'You are no longer an administrator on this device.';
const ENDED_COPY = 'That lecture has already ended.';

export function TakeoverConfirm({ onClose }: { readonly onClose: () => void }): JSX.Element | null {
  const client = useClient();
  const auth = useAuth();
  const session = useRecordingSession();
  const [state, setState] = useState<DangerConfirmState>('confirm');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (state !== 'pending' || !auth.user || session?.takeoverBy !== auth.user.id) return;
    setState('done');
    onClose();
  }, [auth.user, onClose, session?.takeoverBy, state]);

  const confirm = () => {
    setMessage(null);
    setState('pending');
    void client.takeoverRecording().catch((error: unknown) => {
      const code = error instanceof ProblemError ? error.problem.code : null;
      setMessage(code === 'not-authorized' ? NOT_ADMIN_COPY : ENDED_COPY);
      setState('refused');
    });
  };

  const owner = session?.ownerDisplayName ?? 'The current lecturer';
  const title = session?.title ?? 'this lecture';
  return (
    <DangerConfirm
      title="Take over this recording?"
      body={(
        <>
          <p>{owner} is recording {title}. Taking over ends their control of this panel. The lecture keeps recording, and it is still saved as <strong>their</strong> recording.</p>
          <p>This is recorded against your name.</p>
        </>
      )}
      confirmLabel="Take over"
      pendingLabel="Taking over…"
      state={state}
      message={message}
      remedy={null}
      cancelLabel={state === 'refused' ? 'Close' : 'Cancel'}
      onCancel={onClose}
      onConfirm={confirm}
    />
  );
}
