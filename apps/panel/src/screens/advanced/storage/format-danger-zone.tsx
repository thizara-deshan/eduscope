import { useState } from 'react';
import type { StorageVolume } from '@eduscope/shared';
import { DangerConfirm, type DangerConfirmState } from '../../../danger/danger-confirm.js';

interface FormatDangerZoneProps {
  readonly volume: StorageVolume;
  readonly onFormat: (volumeId: string, confirmText: string) => void;
  readonly onCancel: () => void;
  readonly state: DangerConfirmState;
  readonly errorMessage: string | null;
  readonly disabled: boolean;
}

/** S-30 — format is a guarded danger-zone op: type-to-confirm the volume label (or uuid when unlabelled, J-5). */
export function FormatDangerZone({ volume, onFormat, onCancel, state, errorMessage, disabled }: FormatDangerZoneProps): JSX.Element {
  const [typed, setTyped] = useState('');
  const expected = volume.label ?? volume.uuid;
  const matches = typed === expected;

  return (
    <DangerConfirm
      title={`Format ${expected}`}
      body={(
        <div className="us-storage__formatbody">
          <p>This permanently erases all data on this volume. This cannot be undone.</p>
          <label className="us-storage__confirmlabel">
            Type <strong>{expected}</strong> to confirm
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              aria-label={`Type ${expected} to confirm formatting`}
            />
          </label>
        </div>
      )}
      confirmLabel="Format volume"
      pendingLabel="Formatting…"
      state={state}
      message={state === 'refused' ? errorMessage : null}
      onCancel={onCancel}
      onConfirm={() => onFormat(volume.id, typed)}
      confirmDisabled={!matches || disabled}
    />
  );
}
