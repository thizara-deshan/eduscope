import type { UsbVolume } from '@eduscope/shared';
import { formatBytes } from '../format.js';
import './export.css';

/** S-23 §2.2/C-1/C-6 — ≥64 px cards, never a dropdown. A card without room is shown but not selectable. Nothing auto-selected (EXP-D-1). */
export function DrivePicker({
  volumes,
  needBytes,
  value,
  onPick,
}: {
  readonly volumes: readonly UsbVolume[];
  readonly needBytes: number;
  /** The candidate the lecturer has tapped, not yet confirmed (EXP-D-1: nothing auto-selected). */
  readonly value?: string | null;
  readonly onPick: (devicePath: string) => void;
}): JSX.Element {
  return (
    <div className="us-export__picker">
      <p>Choose a drive:</p>
      {volumes.map((v) => {
        const enough = v.freeBytes >= needBytes;
        return (
          <button
            key={v.devicePath}
            type="button"
            className={`us-export__drivecard${v.devicePath === value ? ' us-export__drivecard--selected' : ''}`}
            disabled={!enough}
            aria-pressed={v.devicePath === value}
            onClick={() => onPick(v.devicePath)}
            aria-label={`${v.label}, ${formatBytes(v.freeBytes)} free, ${enough ? 'enough' : 'not enough'} for ${formatBytes(needBytes)}`}
          >
            <span>{v.label}</span>
            <span>{formatBytes(v.freeBytes)} free / {formatBytes(v.capacityBytes)}</span>
            {!enough ? <span className="us-export__shortfall">⚠ Not enough room for {formatBytes(needBytes)}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
