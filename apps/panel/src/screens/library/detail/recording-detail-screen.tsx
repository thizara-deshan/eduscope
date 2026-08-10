import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { formatBytes, formatDateTime, formatDuration } from '../format.js';
import { RecordingBadge } from '../recording-badge.js';
import { FileList } from './file-list.js';
import { RecordingPlayer } from './recording-player.js';
import { RetryMerge } from './retry-merge.js';
import { SegmentList } from './segment-list.js';
import { StreamPicker } from './stream-picker.js';
import { useRecordingDetail } from './use-recording-detail.js';
import './detail.css';

/**
 * S-22 route container: selects the per-state body from `status` +
 * `mergeState` + `files`. The player's file is always the merged/derived
 * deliverable for the selected `streamKey`, falling back to the segment file
 * while `preparing` or `merge failed` (C-4/C-5 — playback on what exists).
 */
export function RecordingDetailScreen(): JSX.Element {
  const { recordingId } = useParams<{ recordingId: string }>();
  const { status, detail } = useRecordingDetail(recordingId ?? '');
  const [streamKey, setStreamKey] = useState<string | null>(null);

  if (status === 'loading') {
    return (
      <main className="us-detail" data-testid="screen" data-screen="S-22" aria-label="Recording detail">
        <Link to="/library">‹ Back to recordings</Link>
        <div className="us-detail__skeleton" data-testid="detail-skeleton" />
      </main>
    );
  }

  if (status === 'not-found') {
    return (
      <main className="us-detail" data-testid="screen" data-screen="S-22" aria-label="Recording detail">
        <p>This recording no longer exists.</p>
        <Link to="/library">‹ Back</Link>
      </main>
    );
  }

  if (status === 'forbidden') {
    return (
      <main className="us-detail" data-testid="screen" data-screen="S-22" aria-label="Recording detail">
        <p>You don&apos;t have access to this recording.</p>
        <Link to="/library">‹ Back</Link>
      </main>
    );
  }

  if (status === 'deleted') {
    return (
      <main className="us-detail" data-testid="screen" data-screen="S-22" aria-label="Recording detail">
        <p>This recording was removed.</p>
        <Link to="/library">‹ Back</Link>
      </main>
    );
  }

  const rec = detail!;
  const preparing = rec.mergeState === 'pending' || rec.mergeState === 'running';
  const mergeFailed = rec.mergeState === 'failed';
  const files = rec.files;
  const streamKeys = [...new Set(files.map((f) => f.streamKey))];
  const activeStreamKey = streamKey ?? streamKeys[0] ?? null;
  // While preparing/merge-failed there is no merged file yet — play a segment file (C-4/C-5).
  const playableFiles = preparing || mergeFailed
    ? files.filter((f) => f.kind === 'segment')
    : files.filter((f) => f.kind === 'merged' || f.kind === 'derived');
  const playingFile = playableFiles.find((f) => f.streamKey === activeStreamKey) ?? playableFiles[0] ?? null;

  const meta = [
    rec.ownerDisplayName, rec.hallDisplayName, formatDateTime(rec.startedAt),
    rec.durationMs !== null ? formatDuration(rec.durationMs) : '—',
    rec.totalBytes !== null ? formatBytes(rec.totalBytes) : '—',
  ].filter(Boolean).join(' · ');

  return (
    <main className="us-detail" data-testid="screen" data-screen="S-22" aria-label="Recording detail">
      <Link to="/library">‹ Back to recordings</Link>
      <div className="us-detail__header">
        <h1>{rec.title}</h1>
        <RecordingBadge rec={rec} />
      </div>
      <p className="us-detail__meta">{meta}</p>

      <StreamPicker files={files} value={activeStreamKey ?? ''} onChange={setStreamKey} />

      {playingFile ? (
        <RecordingPlayer recordingId={rec.id} file={playingFile} />
      ) : (
        <div className="us-detail__player us-detail__player--message">
          <p>No playable file is available for this recording yet.</p>
        </div>
      )}

      {preparing ? (
        <p>We&apos;re preparing the full recording. You can play the segments meanwhile.</p>
      ) : null}
      {mergeFailed ? (
        <>
          <p>We couldn&apos;t combine the segments into one file. The segments are safe.</p>
          <RetryMerge recordingId={rec.id} />
        </>
      ) : null}

      <section aria-label="Segments">
        <h2>{mergeFailed ? 'Segments (kept for audit)' : 'Segments'}</h2>
        <SegmentList segments={rec.segments} />
      </section>

      {!preparing && !mergeFailed ? <FileList recordingId={rec.id} files={files} /> : null}
    </main>
  );
}
