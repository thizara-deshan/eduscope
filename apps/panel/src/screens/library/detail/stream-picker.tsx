import type { RecordingFile } from '@eduscope/shared';
import './detail.css';

/** S-22 §2.3/C-2 — chips over the distinct streamKeys, never a dropdown. Absent when there is one streamKey. */
export function StreamPicker({
  files,
  value,
  onChange,
}: {
  readonly files: readonly RecordingFile[];
  readonly value: string;
  readonly onChange: (streamKey: string) => void;
}): JSX.Element | null {
  const streamKeys = [...new Set(files.map((f) => f.streamKey))];
  if (streamKeys.length <= 1) return null;

  return (
    <div className="us-detail__streampicker">
      <span className="us-detail__streampicker-label">Play:</span>
      {streamKeys.map((key) => (
        <button
          key={key}
          type="button"
          className={`us-detail__streamchip${key === value ? ' us-detail__streamchip--active' : ''}`}
          aria-pressed={key === value}
          onClick={() => onChange(key)}
        >
          {key}
        </button>
      ))}
    </div>
  );
}
