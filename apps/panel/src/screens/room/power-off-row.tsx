import { useId } from 'react';
import { DangerButton } from '../../danger/danger-button.js';
import { useOverlays } from '../../overlays/overlay-host.js';
import { useIsStale, useRecordingSession } from '../../store/selectors.js';
import { useRecorderLock } from '../dashboard/use-recorder-lock.js';
import { focusRecordingTransport, PowerOffConfirm } from './power-off-confirm.js';
import { POWEROFF_BLOCKED_REASON } from './use-power-off.js';

const DISCONNECTED_REASON = 'Not connected — you cannot power off right now.';

export function PowerOffRow(): JSX.Element {
  const overlays = useOverlays();
  const lock = useRecorderLock();
  const session = useRecordingSession();
  const stale = useIsStale();
  const reasonId = useId();
  const loading = session === null;
  const blocked = lock.kind !== 'idle';
  const reason = stale ? DISCONNECTED_REASON : blocked ? POWEROFF_BLOCKED_REASON : null;
  const disabled = loading || reason !== null;

  const openConfirm = () => {
    if (disabled) return;
    overlays.open(<PowerOffConfirm />, { dismissible: false });
  };

  return (
    <div className={`us-poweroffrow${reason ? ' us-poweroffrow--reason' : ''}`}>
      {reason ? <p className="us-poweroffrow__reason" id={reasonId}>{reason}</p> : null}
      <div className="us-poweroffrow__actions">
        {blocked && !stale ? (
          <button type="button" className="us-poweroffrow__jump" onClick={focusRecordingTransport}>
            Go to the lecture
          </button>
        ) : null}
        <DangerButton
          variant="quiet"
          disabled={disabled}
          aria-disabled={disabled}
          aria-describedby={reason ? reasonId : undefined}
          onClick={openConfirm}
        >
          Power off
        </DangerButton>
      </div>
    </div>
  );
}
