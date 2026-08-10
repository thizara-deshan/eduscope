import { DangerConfirm } from '../../danger/danger-confirm.js';

interface StopRecordingConfirmProps {
  readonly disabled: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

export function StopRecordingConfirm({
  disabled,
  onCancel,
  onConfirm,
}: StopRecordingConfirmProps): JSX.Element {
  return (
    <DangerConfirm
      title="Stop recording?"
      body="Are you sure you want to stop recording?"
      confirmLabel="Stop Recording"
      pendingLabel="Stopping…"
      state="confirm"
      confirmDisabled={disabled}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
