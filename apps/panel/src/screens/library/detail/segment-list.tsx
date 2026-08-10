import type { RecordingSegment } from '@eduscope/shared';
import { formatDuration } from '../format.js';
import './detail.css';

function timeOnly(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** S-22 §2.1/C-3/SEG-5 — informational: honest seam markers, never a playback source once merged. Ordered by index (SEG-2), never id arithmetic. */
export function SegmentList({ segments }: { readonly segments: readonly RecordingSegment[] }): JSX.Element {
  const ordered = [...segments].sort((a, b) => a.index - b.index);
  return (
    <ul className="us-detail__segments">
      {ordered.map((seg) => (
        <li key={seg.id} className="us-detail__segment">
          <span>
            {seg.index + 1} · {timeOnly(seg.startedAt)}–{timeOnly(seg.endedAt)} · {seg.durationMs !== null ? formatDuration(seg.durationMs) : '—'}
          </span>
          {(seg.state === 'truncated' || seg.endReason === 'crash') ? (
            <span className="us-detail__segment-marker us-detail__segment-marker--warning">
              ⚠ seam: {seg.endReason === 'crash' ? 'pipeline restart' : 'ended early'}
            </span>
          ) : null}
          {seg.state === 'failed' ? (
            <span className="us-detail__segment-marker us-detail__segment-marker--danger">✕ no usable footage</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
