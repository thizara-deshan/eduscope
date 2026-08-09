import { useEffect, useRef, type KeyboardEvent } from 'react';
import { useQueries } from '@tanstack/react-query';
import { AI_KEYS } from '../../ai/query-keys.js';
import { useInsights } from '../../ai/use-insights.js';
import { useLeaderboard } from '../../ai/use-leaderboard.js';
import { useClient } from '../../client/client-provider.js';
import { useResponsesEvent } from '../../store/selectors.js';
import '../../ai/ai.css';

/**
 * S-19: one student's per-question history, joined client-side on
 * `studentIdNumber` (the leaderboard key, QZ-3/INV-SI-1) across a
 * `useLeaderboard` entry and a `listPublicationResponses` read per sent
 * publication (`useInsights`' list). A missed question is rendered
 * **unanswered**, never incorrect (INV-QP-2) — a late joiner's `partial`
 * history must not read as a string of wrong answers.
 */
export function StudentDetailDialog({
  studentIdNumber, onClose,
}: {
  readonly studentIdNumber: string;
  readonly onClose: () => void;
}) {
  const client = useClient();
  const insights = useInsights();
  const leaderboard = useLeaderboard();
  const responsesEvent = useResponsesEvent();
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

  const entry = leaderboard.entries.find((e) => e.studentIdNumber === studentIdNumber) ?? null;

  const responseQueries = useQueries({
    queries: insights.publications.map((pub) => ({
      queryKey: AI_KEYS.responses(pub.publicationId),
      queryFn: () => client.listPublicationResponses(pub.publicationId),
    })),
  });

  const rows = insights.publications.map((pub, i) => {
    const result = responseQueries[i];
    let mine = result?.data?.items.find((item) => item.studentIdNumber === studentIdNumber) ?? null;
    let stale = result?.data?.stale ?? false;

    if (responsesEvent?.publicationId === pub.publicationId) {
      stale = responsesEvent.stale;
      const delta = responsesEvent.deltas.find((d) => d.studentIdNumber === studentIdNumber);
      if (delta) {
        mine = {
          id: studentIdNumber, publicationId: pub.publicationId, studentIdNumber,
          studentDisplayName: delta.displayName, selectedOptionId: delta.selectedOptionId,
          isCorrect: delta.isCorrect, responseTimeMs: delta.responseTimeMs,
          submittedAt: delta.submittedAt, syncedAt: responsesEvent.syncedAt,
        };
      }
    }

    return {
      publicationId: pub.publicationId,
      prompt: pub.prompt,
      answer: mine,
      loading: result?.isPending ?? false,
      stale,
    };
  });

  const loading = leaderboard.loading || insights.loading || rows.some((r) => r.loading);
  const partial = !loading && rows.length > 0 && rows.some((r) => r.answer === null);
  const stale = rows.some((r) => r.stale);

  return (
    <div className="us-modal__scrim" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        className="us-modal__panel us-studentdialog"
        role="dialog"
        aria-modal="true"
        aria-label="Student detail"
        data-testid="student-detail-dialog"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={trapFocus}
      >
        <header className="us-studentdialog__head">
          <h2>{entry?.displayName ?? studentIdNumber}</h2>
          <button ref={closeRef} type="button" className="us-studentdialog__close" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>

        {stale ? (
          <p className="us-studentdialog__stale" data-testid="student-detail-stale">Data may be out of date</p>
        ) : null}

        <div className="us-studentdialog__body">
          {loading ? (
            <div className="us-studentdialog__skeleton" data-testid="student-detail-loading" aria-label="Loading" />
          ) : (
            <>
              <div className="us-studentdialog__summary">
                <span data-testid="student-detail-score">Score {entry?.points ?? 0}</span>
                <span data-testid="student-detail-rank">Rank #{entry?.rank ?? '—'}</span>
              </div>
              {partial ? (
                <p className="us-studentdialog__partial" data-testid="student-detail-partial">
                  Joined partway through — missed questions show as unanswered.
                </p>
              ) : null}
              <ul className="us-studentdialog__list">
                {rows.map((row) => (
                  <li key={row.publicationId} data-testid={`student-detail-row-${row.publicationId}`}>
                    <span className="us-studentdialog__prompt">{row.prompt}</span>
                    {row.answer === null ? (
                      <span className="us-studentdialog__unanswered">Unanswered</span>
                    ) : (
                      <>
                        <span className={row.answer.isCorrect ? 'us-studentdialog__correct' : 'us-studentdialog__incorrect'}>
                          {row.answer.isCorrect ? 'Correct' : 'Incorrect'}
                        </span>
                        <span className="us-studentdialog__time">{Math.round(row.answer.responseTimeMs / 1000)}s</span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
