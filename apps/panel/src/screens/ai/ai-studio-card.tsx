import type { IntervalMinutes } from '@eduscope/shared';
import { useTicker } from '../../hooks/use-ticker.js';
import { useAiStudio } from '../../ai/use-ai-studio.js';
import '../../ai/ai.css';

const INTERVALS: readonly IntervalMinutes[] = [10, 15, 20, 30];

function formatRemaining(ms: number | null): string {
  if (ms === null) return '--:--';
  const total = Math.max(0, Math.floor(ms / 1_000));
  const minutes = String(Math.floor(total / 60)).padStart(2, '0');
  const seconds = String(total % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

/**
 * S-13: generation control only — countdown, interval, Generate Now, and the
 * "set ready"/"set failed" banner. The questions themselves live in S-14
 * (LP-16, A-14); its "Review Questions" open and the S-20 chip mount are
 * wired by Tasks 5/4 respectively.
 */
export function AiStudioCard() {
  const studio = useAiStudio();
  // INV-G-7: the countdown ticks LOCALLY from the absolute `nextAt` — this is
  // the only per-second re-render in the card, never a WS subscription.
  const now = useTicker(1_000);

  if (studio.loading) {
    return (
      <div
        className="us-assistant us-studio us-studio--loading"
        data-testid="ai-studio-card"
        data-state="loading"
        aria-label="Loading AI Studio"
      />
    );
  }

  const remainingMs = studio.nextAt !== null
    ? Math.max(0, Date.parse(studio.nextAt) - now)
    : studio.remainingMs;

  return (
    <section
      className={`us-assistant us-studio${studio.stale ? ' us-studio--stale' : ''}`}
      data-testid="ai-studio-card"
      data-state={studio.state}
      data-stale={studio.stale || undefined}
    >
      <header className="us-assistant__head">
        <div className="us-assistant__titlewrap">
          <span className="us-assistant__badge" aria-hidden="true">✨</span>
          <div>
            <h1 className="us-assistant__title">Eduscope AI Studio</h1>
            <p className="us-assistant__sub">Turn your lecture into instant classroom questions</p>
          </div>
        </div>
        {/* S-20 chip mounts here (Task 4). */}
      </header>

      <div className="us-studio__body">
        {studio.state === 'degraded' ? (
          <div className="us-studio__unavailable" role="alert" data-testid="ai-studio-degraded">
            <p>The question service is not responding.</p>
            <button
              type="button"
              className="us-genbtn"
              disabled={studio.generatePending}
              onClick={studio.generateNow}
            >
              {studio.generatePending ? 'Retrying…' : 'Retry'}
            </button>
          </div>
        ) : (
          <div className="us-studio__generate">
            <div className="us-genside">
              <span className="us-genside__title">Generate questions every</span>
              <select
                className="us-genside__select"
                value={studio.intervalMinutes}
                disabled={studio.state === 'held' || studio.intervalPending}
                onChange={(event) => studio.setInterval(Number(event.target.value) as IntervalMinutes)}
                aria-label="Auto-generation interval"
              >
                {INTERVALS.map((minutes) => (
                  <option key={minutes} value={minutes}>{minutes} Minutes</option>
                ))}
              </select>
              <span className="us-genside__hint" aria-live="polite">
                {studio.state === 'held'
                  ? 'Paused — nothing new is being transcribed'
                  : studio.intervalPending
                    ? 'Interval updating…'
                    : `⟳ Next set in ${formatRemaining(remainingMs)}`}
              </span>
            </div>

            <div className="us-studio__or" aria-hidden="true">
              <span className="us-studio__orline" />
              <span className="us-studio__ortext">OR</span>
              <span className="us-studio__orline" />
            </div>

            <div className="us-genside">
              <span className="us-genside__title">Generate now</span>
              <button
                type="button"
                className="us-genbtn"
                disabled={studio.state === 'held' || studio.state === 'generating' || studio.generatePending}
                onClick={studio.generateNow}
              >
                {studio.state === 'generating' || studio.generatePending ? 'Generating…' : 'Generate Questions Now'}
              </button>
              <span className="us-genside__hint">From everything taught so far.</span>
            </div>
          </div>
        )}

        {studio.refusal !== null ? (
          <p className="us-studio__refusal" role="alert" data-testid="ai-studio-refusal">{studio.refusal}</p>
        ) : null}

        {studio.setFailed ? (
          <div className="us-studio__setfailed" role="alert" data-testid="ai-studio-setfailed">
            <span>Couldn&apos;t generate questions ({studio.setErrorReason}).</span>
            <button
              type="button"
              className="us-genbtn"
              disabled={studio.generatePending}
              onClick={studio.generateNow}
            >
              Retry
            </button>
          </div>
        ) : null}

        {studio.setReady ? (
          <div className="us-readybanner" data-testid="ai-studio-readybanner">
            <span className="us-readybanner__icon" aria-hidden="true">✓</span>
            <div className="us-readybanner__text">
              <span className="us-readybanner__title">A new set is ready</span>
              <span className="us-readybanner__sub">
                {studio.draftCount} {studio.draftCount === 1 ? 'question' : 'questions'} drafted from your lecture
              </span>
            </div>
            {/* Opens S-14 (Task 5). */}
            <button type="button" className="us-readybanner__btn">Review Questions</button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
