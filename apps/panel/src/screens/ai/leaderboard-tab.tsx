import { useLeaderboard } from '../../ai/use-leaderboard.js';
import { useOverlays } from '../../overlays/overlay-host.js';
import { StudentDetailDialog } from './student-detail-dialog.js';
import '../../ai/ai.css';

const MEDALS: Record<1 | 2 | 3, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

function medalFor(rank: number): string | null {
  return rank === 1 || rank === 2 || rank === 3 ? MEDALS[rank] : null;
}

/**
 * S-17: dense ranking, `{correct}/{answered}`, score (`correct × 10`),
 * accuracy, avg response time. **Panel-only — never projected** (LP-17,
 * A-16, INV-LB-3): this tab carries no projector affordance of any kind.
 */
export function LeaderboardTab() {
  const lb = useLeaderboard();
  const overlays = useOverlays();

  const openStudent = (studentIdNumber: string) => {
    const id = overlays.open(<StudentDetailDialog studentIdNumber={studentIdNumber} onClose={() => overlays.close(id)} />);
  };

  if (lb.loading) {
    return <div className="us-insights__skeleton" data-testid="leaderboard-loading" aria-label="Loading" />;
  }

  if (lb.quizUnavailable) {
    return (
      <p className="us-empty" data-testid="leaderboard-quiz-unavailable">
        The leaderboard needs an active quiz session.
      </p>
    );
  }

  return (
    <div data-testid="leaderboard-tab" data-panel-only="true">
      <header className="us-lb__head">
        {lb.live ? <span className="us-lb__live" data-testid="leaderboard-live-dot" aria-label="Live" /> : null}
        {lb.stale ? (
          <span className="us-lb__stale" data-testid="leaderboard-stale">Scores may be out of date</span>
        ) : null}
      </header>

      {lb.entries.length === 0 ? (
        <p className="us-empty" data-testid="leaderboard-empty">No answers yet</p>
      ) : (
        <ol className="us-lb__list" aria-label="Leaderboard ranking">
          {lb.entries.map((entry) => (
            <li key={entry.studentIdNumber}>
              <button
                type="button"
                className="us-lb__row"
                data-testid={`leaderboard-row-${entry.studentIdNumber}`}
                onClick={() => openStudent(entry.studentIdNumber)}
              >
                <span className="us-lb__rank">{medalFor(entry.rank) ?? entry.rank}</span>
                <span className="us-lb__name">{entry.displayName}</span>
                <span className="us-lb__fraction">{entry.correct}/{entry.answered}</span>
                <span className="us-lb__statvalue">{entry.points}</span>
                <span className="us-lb__accuracy">{Math.round(entry.accuracy * 100)}%</span>
                <span className="us-lb__time">{Math.round(entry.avgResponseMs / 1000)}s</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
