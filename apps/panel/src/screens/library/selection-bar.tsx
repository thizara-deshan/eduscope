import { formatBytes } from './format.js';
import './library.css';

/** S-21 §2.4 — replaces the title row in selection mode. Owns only the count/Σ-bytes display and the Cancel/Copy-to-USB actions; selection state itself lives in the caller (library-screen.tsx). */
export function SelectionBar({
  count,
  totalBytes,
  onCancel,
  onExport,
}: {
  readonly count: number;
  readonly totalBytes: number;
  readonly onCancel: () => void;
  readonly onExport: () => void;
}): JSX.Element {
  return (
    <div className="us-selectionbar">
      <span className="us-selectionbar__summary">
        {count} selected · {formatBytes(totalBytes)}
      </span>
      <div className="us-selectionbar__actions">
        <button type="button" className="us-selectionbar__cancel" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="us-selectionbar__export" onClick={onExport} disabled={count === 0}>
          Copy to USB →
        </button>
      </div>
    </div>
  );
}
