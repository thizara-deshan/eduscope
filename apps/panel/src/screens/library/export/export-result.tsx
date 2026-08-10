import type { UsbVolume } from '@eduscope/shared';
import './export.css';

/** S-23 §2.5/§2.6 — completed is unmissable (large, --success, aria-live); every failure body asserts the source is untouched (C-5). */
export function ExportResult({
  state,
  volume,
  error,
  onRetry,
  onDone,
}: {
  readonly state: 'completed' | 'drive-removed' | 'failed' | 'cancelled';
  readonly volume: UsbVolume | null;
  readonly error: string | null;
  readonly onRetry: () => void;
  readonly onDone: () => void;
}): JSX.Element {
  if (state === 'completed') {
    return (
      <div className="us-export__result us-export__result--success" aria-live="polite">
        <p className="us-export__result-title">✓ Done</p>
        <p>Copied to {volume?.label ?? 'the drive'}.</p>
        <p className="us-export__safe">Safe to remove the drive.</p>
        <button type="button" onClick={onDone}>Done</button>
      </div>
    );
  }

  if (state === 'cancelled') {
    return (
      <div className="us-export__result">
        <p>Copy cancelled.</p>
        <p>Nothing was removed from the device.</p>
        <button type="button" onClick={onDone}>Done</button>
      </div>
    );
  }

  const message = state === 'drive-removed'
    ? 'The drive was removed before the copy finished.'
    : (error ?? 'The copy failed.');

  return (
    <div className="us-export__result">
      <p>⚠ {message}</p>
      <p>Your recordings are safe on the device.</p>
      <button type="button" onClick={onDone}>Cancel</button>
      <button type="button" onClick={onRetry}>Try again</button>
    </div>
  );
}
