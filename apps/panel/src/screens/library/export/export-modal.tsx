import { useState } from 'react';
import { formatBytes } from '../format.js';
import { DrivePicker } from './drive-picker.js';
import { ExportProgress } from './export-progress.js';
import { ExportResult } from './export-result.js';
import { useExport } from './use-export.js';
import './export.css';

/**
 * S-23 — the 680 px overlay: insert → pick a drive → real-byte progress with
 * ETA → an unmissable "Safe to remove". `listExportTargets` on open marks the
 * session subscribed to `usb.volumes` (C-3/CG-3).
 */
export function ExportModal({
  recordingIds,
  needBytes,
  onClose,
}: {
  readonly recordingIds: readonly string[];
  readonly needBytes: number;
  readonly onClose: () => void;
}): JSX.Element {
  const exp = useExport(recordingIds, needBytes);
  const [selected, setSelected] = useState<string | null>(null);

  const selectedVolume = exp.volumes.find((v) => v.devicePath === selected) ?? null;

  return (
    <div className="us-export__modal" role="dialog" aria-label="Copy to USB">
      <p className="us-export__summary">{recordingIds.length} recordings · {formatBytes(needBytes)} to copy</p>

      {exp.state === 'no-drive' ? (
        <>
          <p>Insert a USB drive to continue.</p>
          <p>The device disk and the recordings drive are never offered.</p>
          <button type="button" onClick={onClose}>Cancel</button>
        </>
      ) : null}

      {exp.state === 'insufficient-space' ? (
        <>
          <p>⚠ None of the connected drives has room for {formatBytes(needBytes)}.</p>
          <p>Free up space on a drive, or insert a larger one, then try again.</p>
          <button type="button" onClick={onClose}>Cancel</button>
        </>
      ) : null}

      {exp.state === 'drives-listed' ? (
        <>
          <DrivePicker volumes={exp.volumes} needBytes={needBytes} value={selected} onPick={setSelected} />
          <button type="button" onClick={onClose}>Cancel</button>
          <button
            type="button"
            disabled={!selected}
            onClick={() => selected && exp.pick(selected)}
          >
            Copy {formatBytes(needBytes)} →
          </button>
        </>
      ) : null}

      {exp.state === 'create-refused' ? (
        <>
          <p>⚠ {exp.refusalReason}</p>
          <DrivePicker volumes={exp.volumes} needBytes={needBytes} value={selected} onPick={setSelected} />
          <button type="button" onClick={onClose}>Cancel</button>
          <button
            type="button"
            disabled={!selected}
            onClick={() => selected && exp.pick(selected)}
          >
            Copy {formatBytes(needBytes)} →
          </button>
        </>
      ) : null}

      {(exp.state === 'queued' || exp.state === 'copying') && exp.job ? (
        <ExportProgress job={exp.job} etaSeconds={exp.etaSeconds} onCancel={exp.cancel} />
      ) : null}

      {(exp.state === 'completed' || exp.state === 'cancelled' || exp.state === 'drive-removed' || exp.state === 'failed') ? (
        <ExportResult
          state={exp.state}
          volume={selectedVolume}
          error={exp.job?.error ?? null}
          onRetry={exp.retry}
          onDone={onClose}
        />
      ) : null}
    </div>
  );
}
