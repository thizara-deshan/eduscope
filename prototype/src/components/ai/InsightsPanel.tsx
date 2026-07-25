import { useState } from 'react'
import { useQuestions } from '../../context/QuestionContext'
import { SentToProjectorPanel } from './SentToProjectorPanel'
import { LeaderboardPanel } from './LeaderboardPanel'
import { cn } from '../ui/cn'

type Tab = 'previous' | 'leaderboard'

/** Right-column dark card: Previous Questions / Leaderboard tabs. */
export function InsightsPanel() {
  const { respondingIds } = useQuestions()
  const [tab, setTab] = useState<Tab>('previous')

  return (
    <section className="us-insights us-assistant">
      <div className="us-insights__tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'previous'}
          className={cn('us-insights__tab', tab === 'previous' && 'us-insights__tab--active')}
          onClick={() => setTab('previous')}
        >
          Previous Questions
        </button>
        <button
          role="tab"
          aria-selected={tab === 'leaderboard'}
          className={cn('us-insights__tab', tab === 'leaderboard' && 'us-insights__tab--active')}
          onClick={() => setTab('leaderboard')}
        >
          Leaderboard
          {respondingIds.length > 0 && <span className="us-tab__live" aria-label="live" />}
        </button>
      </div>

      <div className="us-insights__body">
        {tab === 'previous' ? <SentToProjectorPanel /> : <LeaderboardPanel />}
      </div>
    </section>
  )
}
