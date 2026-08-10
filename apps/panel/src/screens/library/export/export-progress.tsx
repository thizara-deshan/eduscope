import type { ExportJobPayload } from '@eduscope/shared';
import { formatBytes } from '../format.js';
import './export.css';

function formatEta(seconds: number | null): string {
  if (seconds === null) return 'Starting…';
  const minutes = Math.ceil(seconds / 60);
  return `about ${minutes} min left`;
}

/** S-23 §2.4/C-2 — bar + percentage from real bytesCopied/bytesTotal, never freeBytes. */
export function ExportProgress({
  job,
  etaSeconds,
  onCancel,
}: {
  readonly job: ExportJobPayload;
  readonly etaSeconds: number | null;
  readonly onCancel: () => void;
}): JSX.Element {
  const pct = job.bytesTotal > 0 ? Math.round((job.bytesCopied / job.bytesTotal) * 100) : 0;
  return (
    <div className="us-export__progress">
      <p>Copying…</p>
      <div
        className="us-export__bar"
        role="progressbar"
        aria-label="Copy progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={`${pct}%`}
      >
        <div className="us-export__barfill" style={{ width: `${pct}%` }} />
      </div>
      <p>{formatBytes(job.bytesCopied)} of {formatBytes(job.bytesTotal)} · {formatEta(etaSeconds)}</p>
      <p>Don&apos;t remove the drive until this finishes.</p>
      <button type="button" onClick={onCancel}>Cancel copy</button>
    </div>
  );
}
