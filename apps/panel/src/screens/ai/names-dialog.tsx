import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { usePublicationResponses } from '../../ai/use-publication-responses.js';
import { useWsShallow } from '../../store/selectors.js';
import '../../ai/ai.css';

type Filter = 'responded' | 'correct' | 'incorrect';

/**
 * S-18: who responded / who was correct / who was incorrect for one sent
 * question. Minimal PII (DM-14) — closes on scrim tap and does not persist
 * across navigation (no state survives unmount).
 */
export function NamesDialog({
  publicationId, onClose,
}: {
  readonly publicationId: string;
  readonly onClose: () => void;
}) {
  const responses = usePublicationResponses(publicationId);
  const alerts = useWsShallow((s) => Object.values(s.alerts));
  const syncFailed = alerts.some((a) => a.code === 'quiz.sync-stale' && a.clearedAt === null);
  const [filter, setFilter] = useState<Filter>('responded');
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => closeRef.current?.focus(), []);

  const trapFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [],
    );
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0]!;
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const filtered = responses.items.filter((item) => (
    filter === 'correct' ? item.isCorrect : filter === 'incorrect' ? !item.isCorrect : true
  ));
  const correctCount = responses.items.filter((i) => i.isCorrect).length;
  const incorrectCount = responses.items.length - correctCount;

  return (
    <div className="us-modal__scrim" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        className="us-modal__panel us-namesdialog"
        role="dialog"
        aria-modal="true"
        aria-label="Responses"
        data-testid="names-dialog"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={trapFocus}
      >
        <header className="us-namesdialog__head">
          <h2>Responses</h2>
          <button ref={closeRef} type="button" className="us-namesdialog__close" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>

        {syncFailed ? (
          <p className="us-namesdialog__syncfailed" role="alert" data-testid="names-dialog-syncfailed">
            The link to the quiz server failed — these names may be incomplete.
          </p>
        ) : responses.stale ? (
          <p className="us-namesdialog__stalebanner" data-testid="names-dialog-stale">
            May be out of date — synced {responses.syncedAt ?? 'unknown'}
          </p>
        ) : null}

        <div className="us-tabs" role="tablist" aria-label="Filter">
          <button
            type="button"
            role="tab"
            className={`us-tab${filter === 'responded' ? ' us-tab--active' : ''}`}
            aria-selected={filter === 'responded'}
            onClick={() => setFilter('responded')}
          >
            Responded ({responses.items.length})
          </button>
          <button
            type="button"
            role="tab"
            className={`us-tab${filter === 'correct' ? ' us-tab--active' : ''}`}
            aria-selected={filter === 'correct'}
            onClick={() => setFilter('correct')}
          >
            Correct ({correctCount})
          </button>
          <button
            type="button"
            role="tab"
            className={`us-tab${filter === 'incorrect' ? ' us-tab--active' : ''}`}
            aria-selected={filter === 'incorrect'}
            onClick={() => setFilter('incorrect')}
          >
            Incorrect ({incorrectCount})
          </button>
        </div>

        <div className="us-namesdialog__body">
          {responses.loading ? (
            <div className="us-namesdialog__skeleton" data-testid="names-dialog-loading" aria-label="Loading" />
          ) : responses.items.length === 0 ? (
            <p className="us-empty" data-testid="names-dialog-empty">Nobody has answered yet</p>
          ) : (
            <ul className="us-namesdialog__list" data-testid="names-dialog-list">
              {filtered.map((item) => (
                <li key={item.studentIdNumber}>{item.studentDisplayName}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
