import { useState } from 'react';
import type { Recording } from '@eduscope/shared';
import { RecordingBadge } from './recording-badge.js';
import { recordingBadge, type RecordingBadgeLive } from './use-recording-badge.js';
import { formatBytes, formatDateTime, formatDuration } from './format.js';
import './library.css';

const DELETE_REASON_COPY: Record<string, string> = {
  admin: 'removed by an administrator',
  retention: 'removed after 14 days',
  'disk-pressure': 'removed to free up space',
};

/**
 * S-21 §2.1/§8 — one 64 px row. The body is the detail tap target; Play, ⋯
 * and the selection checkbox are each their own ≥44 px target (C-4: no
 * hover-revealed actions). Presentation-only: knows nothing about fetching or
 * roles (the caller decides `showOwner`/`selectable`/admin-only ⋯ items).
 */
export function RecordingRow({
  rec,
  live,
  showOwner,
  selectable,
  selected,
  onOpen,
  onPlay,
  onToggle,
  onMenu,
  onDelete,
}: {
  readonly rec: Recording;
  readonly live?: RecordingBadgeLive | undefined;
  readonly showOwner: boolean;
  readonly selectable: boolean;
  readonly selected: boolean;
  readonly onOpen: () => void;
  readonly onPlay: () => void;
  readonly onToggle: () => void;
  readonly onMenu: () => void;
  /** Admin only (U-6): absent for a lecturer, not merely disabled. */
  readonly onDelete?: (() => void) | undefined;
}): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const isTombstone = rec.state === 'deleted';
  const duration = rec.durationMs !== null ? formatDuration(rec.durationMs) : '—';
  const badge = recordingBadge(rec, live);
  const accessibleName = `${rec.title}, ${badge.label}, ${duration}`;
  const metaParts = [
    ...(showOwner ? [rec.ownerDisplayName] : []),
    rec.hallDisplayName,
    formatDateTime(rec.startedAt),
    duration,
    rec.totalBytes !== null ? formatBytes(rec.totalBytes) : '—',
    `${rec.segmentCount} segment${rec.segmentCount === 1 ? '' : 's'}`,
  ];

  return (
    <li className={`us-reclist__item${isTombstone ? ' us-reclist__item--tombstone' : ''}`}>
      {selectable ? (
        <input
          type="checkbox"
          className="us-reclist__checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label={`Select ${rec.title}`}
        />
      ) : null}
      <button
        type="button"
        className="us-reclist__body"
        aria-label={accessibleName}
        onClick={selectable ? onToggle : onOpen}
      >
        <span className="us-reclist__title">{rec.title}</span>
        <span className="us-reclist__meta">{metaParts.join(' · ')}</span>
        {isTombstone ? (
          <span className="us-reclist__tombstone-note">
            {`Deleted ${formatDateTime(rec.deletedAt ?? rec.startedAt)}`}
            {rec.deleteReason ? ` · ${DELETE_REASON_COPY[rec.deleteReason] ?? rec.deleteReason}` : ''}
          </span>
        ) : (
          <RecordingBadge rec={rec} live={live} />
        )}
      </button>
      {!isTombstone ? (
        <button type="button" className="us-reclist__play" aria-label={`Play ${rec.title}`} onClick={onPlay}>
          ▷ Play
        </button>
      ) : null}
      <div className="us-reclist__menuwrap">
        <button
          type="button"
          className="us-reclist__menu"
          aria-label={`More actions for ${rec.title}`}
          aria-expanded={menuOpen}
          onClick={() => { setMenuOpen((v) => !v); onMenu(); }}
        >
          ⋯
        </button>
        {menuOpen ? (
          <div className="us-reclist__menupopup" role="menu">
            {onDelete ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => { setMenuOpen(false); onDelete(); }}
              >
                Delete
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}
