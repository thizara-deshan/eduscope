import { useInsights, type InsightsPublicationView } from '../../ai/use-insights.js';
import '../../ai/ai.css';

const CLOSE_REASON_COPY: Record<NonNullable<InsightsPublicationView['closeReason']>, string> = {
  'next-question': 'Closed for the next question',
  'session-ended': 'Closed — session ended',
  'lecturer-closed': 'Closed by you',
};

/**
 * S-16 body: sent questions newest-first, the correct answer in green, and
 * Responses/Correct/Incorrect badges that drill into S-18. Panel-only —
 * never projected (LP-17, A-16, INV-LB-3).
 */
export function PreviousQuestionsTab() {
  const insights = useInsights();
  // Opens S-18 (Task 9).
  const openNames: (publicationId: string) => void = () => {};

  if (insights.loading) {
    return <div className="us-insights__skeleton" data-testid="previous-questions-loading" aria-label="Loading" />;
  }

  return (
    <div data-testid="previous-questions-tab">
      {insights.syncFailed ? (
        <p className="us-insights__syncfailed" role="alert" data-testid="previous-questions-syncfailed">
          The link to the quiz server failed. Recording is unaffected.
        </p>
      ) : insights.responsesStale ? (
        <p className="us-insights__stalebanner" data-testid="previous-questions-stale">
          Responses may be out of date
        </p>
      ) : null}

      {insights.publications.length === 0 ? (
        <p className="us-empty" data-testid="previous-questions-empty">
          This fills as questions are sent to students.
        </p>
      ) : (
        <ul className="us-insights__list">
          {insights.publications.map((p) => (
            <li key={p.publicationId} className="us-pqcard" data-testid={`publication-card-${p.publicationId}`}>
              <div className="us-pqcard__head">
                <span className="us-pqcard__prompt">{p.prompt}</span>
                {p.isShowing ? <span className="us-pqcard__badge">Now showing</span> : null}
              </div>
              {p.correctOptionText !== null ? (
                <p className="us-pqcard__correct">{p.correctOptionText}</p>
              ) : null}

              {p.state === 'failed' ? (
                <p className="us-pqcard__failed" role="alert" data-testid={`publication-card-${p.publicationId}-failed`}>
                  Couldn&apos;t send to the projector — the projector stayed on slides.
                </p>
              ) : p.reveal ? (
                <p className="us-pqcard__reveal" data-testid={`publication-card-${p.publicationId}-reveal`}>
                  Re-shown with the answer revealed — students can no longer respond.
                </p>
              ) : p.state === 'closed' && p.closeReason !== null ? (
                <p className="us-pqcard__closed">{CLOSE_REASON_COPY[p.closeReason]}</p>
              ) : null}

              <div className="us-pqcard__badges">
                <button
                  type="button"
                  className="us-pqcard__statbtn"
                  onClick={() => openNames(p.publicationId)}
                  aria-label={`${p.responseCount} responses — view names`}
                >
                  {p.responseCount} Responses
                </button>
                <button
                  type="button"
                  className="us-pqcard__statbtn us-pqcard__statbtn--correct"
                  onClick={() => openNames(p.publicationId)}
                  aria-label={`${p.correctCount} correct — view names`}
                >
                  {p.correctCount} Correct
                </button>
                <button
                  type="button"
                  className="us-pqcard__statbtn us-pqcard__statbtn--incorrect"
                  onClick={() => openNames(p.publicationId)}
                  aria-label={`${p.incorrectCount} incorrect — view names`}
                >
                  {p.incorrectCount} Incorrect
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
