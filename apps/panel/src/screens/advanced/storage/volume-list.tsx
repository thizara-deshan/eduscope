import { useState } from 'react';
import type { StorageVolume } from '@eduscope/shared';
import { DiskHealthRow } from './disk-health-row.js';
import { FormatDangerZone } from './format-danger-zone.js';
import type { DangerConfirmState } from '../../../danger/danger-confirm.js';

interface VolumeListProps {
  readonly volumes: StorageVolume[];
  readonly formatVolume: (volumeId: string, confirmText: string) => void;
  readonly formattingId: string | null;
  readonly formatError: string | null;
  readonly clearFormatError: () => void;
  readonly disabled: boolean;
}

export function VolumeList({ volumes, formatVolume, formattingId, formatError, clearFormatError, disabled }: VolumeListProps): JSX.Element {
  const [openVolumeId, setOpenVolumeId] = useState<string | null>(null);

  const formatState = (volumeId: string): DangerConfirmState => {
    if (formattingId === volumeId) return 'pending';
    if (volumeId === openVolumeId && formatError) return 'refused';
    if (volumeId === openVolumeId) return 'confirm';
    return 'done';
  };

  return (
    <section className="us-adm__card us-adm__section us-storage__card" aria-label="Volumes">
      <h2 className="us-device__eyebrow">Volumes</h2>
      {volumes.length === 0 ? <p className="us-adm__empty">No registered volumes.</p> : (
        <ul className="us-storage__volumelist">
          {volumes.map((v) => (
            <li key={v.id} className="us-storage__volumerow" data-testid={`volume-${v.id}`}>
              <div className="us-device__field">
                <span className="us-device__label">{v.label ?? v.uuid}</span>
                <span className="us-device__value">{v.state}</span>
              </div>
              <DiskHealthRow smartStatus={v.smartStatus} />
              {v.role === 'recordings' ? (
                <button
                  type="button"
                  className="us-adm__danger"
                  disabled={disabled}
                  onClick={() => { clearFormatError(); setOpenVolumeId(v.id); }}
                >
                  Format…
                </button>
              ) : null}
              {openVolumeId === v.id ? (
                <FormatDangerZone
                  volume={v}
                  onFormat={formatVolume}
                  onCancel={() => setOpenVolumeId(null)}
                  state={formatState(v.id)}
                  errorMessage={formatError}
                  disabled={disabled}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
