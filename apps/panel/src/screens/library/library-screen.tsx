import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../auth/auth-context.js';
import { useOverlays } from '../../overlays/overlay-host.js';
import { useIsStale, useUploadJobEvents } from '../../store/selectors.js';
import { DeleteRecordingConfirm } from './delete-recording-confirm.js';
import { ExportModal } from './export/export-modal.js';
import { LibraryFilters } from './library-filters.js';
import { RecordingRow } from './recording-row.js';
import { SelectionBar } from './selection-bar.js';
import { useRecordings, type LibraryFilters as LibraryFiltersValue } from './use-recordings.js';
import './library.css';

const REMOVED_REASON_COPY: Record<string, string> = {
  admin: 'This recording was removed by an administrator.',
  retention: 'This recording was removed after 14 days.',
  'disk-pressure': 'This recording was removed to free up space.',
};

/**
 * S-21 route container: header/filters/list/load-more/empty, wired real. The
 * list body scrolls internally — the page itself never scrolls (§8). Task 16
 * replaces the `onExport` no-op with the real S-23 overlay open.
 */
export function LibraryScreen(): JSX.Element {
  const { role } = useAuth();
  const isAdmin = role === 'admin';
  const navigate = useNavigate();
  const overlays = useOverlays();
  const stale = useIsStale();
  const [filters, setFilters] = useState<LibraryFiltersValue>({});
  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { loading, rows, removed, hasMore, loadMore, loadingMore } = useRecordings(filters);
  const uploadJobs = useUploadJobEvents();

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const exitSelection = () => {
    setSelectionMode(false);
    setSelected(new Set());
  };

  const selectedRows = rows.filter((r) => selected.has(r.id));
  const selectedBytes = selectedRows.reduce((sum, r) => sum + (r.totalBytes ?? 0), 0);

  const openDelete = (rec: (typeof rows)[number]) => {
    let overlayId = -1;
    overlayId = overlays.open(
      <DeleteRecordingConfirm rec={rec} onDone={() => overlays.close(overlayId)} />,
      { dismissible: false },
    );
  };

  const openExport = () => {
    let overlayId = -1;
    const ids = [...selected];
    overlayId = overlays.open(
      <ExportModal recordingIds={ids} needBytes={selectedBytes} onClose={() => overlays.close(overlayId)} />,
      { dismissible: true },
    );
  };

  if (loading) {
    return (
      <main className="us-library" data-testid="screen" data-screen="S-21" aria-label="Recordings">
        <div className="us-library__header">
          <h1>Recordings</h1>
        </div>
        <ul className="us-reclist" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className="us-reclist__item us-reclist__item--skeleton" data-testid="row-skeleton" />
          ))}
        </ul>
      </main>
    );
  }

  if (rows.length === 0 && removed.length === 0) {
    return (
      <main className="us-library" data-testid="screen" data-screen="S-21" aria-label="Recordings">
        <div className="us-library__header">
          <h1>Recordings</h1>
        </div>
        <div className="us-library__empty">
          {isAdmin ? (
            <p>No recordings on this device.</p>
          ) : (
            <>
              <p>You haven&apos;t recorded anything yet.</p>
              <p>Recordings appear here after you stop a lecture.</p>
            </>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="us-library" data-testid="screen" data-screen="S-21" aria-label="Recordings">
      <div className="us-library__header">
        {selectionMode ? (
          <SelectionBar
            count={selected.size}
            totalBytes={selectedBytes}
            onCancel={exitSelection}
            onExport={openExport}
          />
        ) : (
          <>
            <h1>Recordings</h1>
            <LibraryFilters value={filters} isAdmin={isAdmin} onChange={setFilters} />
            <button type="button" className="us-library__select" onClick={() => setSelectionMode(true)}>Select</button>
          </>
        )}
      </div>

      {removed.length > 0 ? (
        <ul className="us-library__removed" aria-live="polite">
          {removed.map((r) => (
            <li key={r.recordingId}>
              {REMOVED_REASON_COPY[r.deleteReason ?? ''] ?? 'This recording was removed.'}
            </li>
          ))}
        </ul>
      ) : null}

      <ul className="us-reclist">
        {rows.map((rec) => {
          const job = uploadJobs[rec.id];
          return (
            <RecordingRow
              key={rec.id}
              rec={rec}
              live={{ progressPct: job?.progressPct, nextAttemptAt: job?.nextAttemptAt }}
              showOwner={isAdmin}
              selectable={selectionMode}
              selected={selected.has(rec.id)}
              onOpen={() => navigate(`/advanced/library/${rec.id}`)}
              onPlay={() => navigate(`/advanced/library/${rec.id}`)}
              onToggle={() => toggleSelected(rec.id)}
              onMenu={() => {}}
              onDelete={isAdmin ? () => openDelete(rec) : undefined}
            />
          );
        })}
      </ul>

      {hasMore ? (
        <button
          type="button"
          className="us-library__load-more"
          disabled={loadingMore || stale}
          onClick={loadMore}
        >
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      ) : null}
    </main>
  );
}
