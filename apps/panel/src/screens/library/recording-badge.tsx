import type { Recording } from '@eduscope/shared';
import { recordingBadge, type RecordingBadgeLive } from './use-recording-badge.js';
import './library.css';

/**
 * S-21 §3 / LIB-D-2 — the label is always text; colour is never the only
 * signal. Pure of any data source: it can only receive a `Recording`, so it
 * can never be wired to a placebo (mirrors S-20's `quiz-qr` discipline).
 */
export function RecordingBadge({
  rec,
  live,
}: {
  readonly rec: Recording;
  readonly live?: RecordingBadgeLive;
}) {
  const badge = recordingBadge(rec, live);
  return (
    <span className="us-badge-group">
      <span className={`us-badge us-badge--${badge.tone}`}>
        <span aria-hidden="true">{badge.glyph}</span>
        <span>{badge.label}</span>
      </span>
      {badge.secondary ? (
        <span className="us-badge__secondary us-badge--warning">{badge.secondary}</span>
      ) : null}
    </span>
  );
}
