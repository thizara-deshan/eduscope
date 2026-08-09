import { useState } from 'react';
import { LeaderboardTab } from './leaderboard-tab.js';
import { PreviousQuestionsTab } from './previous-questions-tab.js';
import '../../ai/ai.css';

export type InsightsTab = 'previous' | 'leaderboard';

/**
 * S-16/S-17 tab wrapper: the dark insights card filling the rest of the
 * sidebar below S-07/S-08. Owns tab state; tabs stay visible (and tappable)
 * even when `collapsed` (W3-D-6's meeting-accordion mutual exclusion) shrinks
 * the body to nothing.
 */
export function InsightsColumn({ collapsed = false }: { readonly collapsed?: boolean }) {
  const [tab, setTab] = useState<InsightsTab>('previous');

  return (
    <section
      className={`us-assistant us-insightswrap${collapsed ? ' us-insightswrap--collapsed' : ''}`}
      data-testid="insights-column"
      aria-label="Insights"
    >
      <div className="us-tabs" role="tablist" aria-label="Insights tabs">
        <button
          type="button"
          role="tab"
          className={`us-tab${tab === 'previous' ? ' us-tab--active' : ''}`}
          aria-selected={tab === 'previous'}
          onClick={() => setTab('previous')}
        >
          Previous Questions
        </button>
        <button
          type="button"
          role="tab"
          className={`us-tab${tab === 'leaderboard' ? ' us-tab--active' : ''}`}
          aria-selected={tab === 'leaderboard'}
          onClick={() => setTab('leaderboard')}
        >
          Leaderboard
        </button>
      </div>
      {!collapsed ? (
        <div className="us-insightswrap__body">
          {tab === 'previous' ? <PreviousQuestionsTab /> : <LeaderboardTab />}
        </div>
      ) : null}
    </section>
  );
}
