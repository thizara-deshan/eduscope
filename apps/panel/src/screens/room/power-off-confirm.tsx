import { useEffect } from 'react';
import { DangerButton } from '../../danger/danger-button.js';
import { DangerConfirm, type DangerConfirmState } from '../../danger/danger-confirm.js';
import { useOverlays } from '../../overlays/overlay-host.js';
import { useAlertSuppression } from '../../shell/alert-suppression.js';
import { useProvisioning } from '../../shell/use-provisioning.js';
import { POWEROFF_BLOCKED_REASON, usePowerOff } from './use-power-off.js';
import './room.css';

export function focusRecordingTransport(): void {
  const target = document.getElementById('recording-transport');
  target?.scrollIntoView?.({ block: 'center' });
  target?.focus();
}

export function PowerOffConfirm(): JSX.Element {
  const powerOff = usePowerOff();
  const provisioning = useProvisioning();
  const overlays = useOverlays();

  useEffect(() => {
    const suppression = useAlertSuppression.getState();
    suppression.suppress('poweroff.refused');
    return () => useAlertSuppression.getState().release('poweroff.refused');
  }, []);

  const close = () => {
    const overlayId = overlays.stack.at(-1)?.id;
    if (overlayId !== undefined) overlays.close(overlayId);
  };
  const goToLecture = () => {
    close();
    requestAnimationFrame(focusRecordingTransport);
  };
  const hall = provisioning.hallDisplayName ?? 'This room';

  if (powerOff.state.kind === 'accepted' || powerOff.state.kind === 'accepted-not-halted') {
    return (
      <div className="us-poweroffterminal" role="alert" aria-live="assertive">
        <div className="us-poweroffterminal__content">
          <h2>Shutting down</h2>
          <p>{hall} · Eduscope recording panel</p>
          {powerOff.state.kind === 'accepted-not-halted' ? (
            <div className="us-poweroffterminal__retry">
              <p>The device has not shut down yet.</p>
              <DangerButton variant="solid" onClick={powerOff.retry}>Try again</DangerButton>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  const confirmState: DangerConfirmState = powerOff.state.kind === 'pending'
    ? 'pending'
    : powerOff.state.kind === 'confirm' ? 'confirm' : 'refused';
  const recordingRefusal = powerOff.state.kind === 'refused-recording';
  const otherRefusal = powerOff.state.kind === 'refused-other' ? powerOff.state.title : null;

  return (
    <DangerConfirm
      title="Power off this device?"
      body={(
        <>
          <p className="us-poweroffconfirm__device">{hall} · Eduscope recording panel</p>
          <p>The device will halt. Someone has to press the power button in this room to turn it back on.</p>
        </>
      )}
      confirmLabel="Power off"
      pendingLabel="Powering off…"
      state={confirmState}
      message={recordingRefusal ? POWEROFF_BLOCKED_REASON : otherRefusal}
      remedy={recordingRefusal ? (
        <button type="button" className="us-poweroff__primary" onClick={goToLecture}>
          Go to the lecture
        </button>
      ) : null}
      cancelLabel={confirmState === 'refused' ? 'Close' : 'Cancel'}
      onCancel={close}
      onConfirm={powerOff.confirm}
    />
  );
}
