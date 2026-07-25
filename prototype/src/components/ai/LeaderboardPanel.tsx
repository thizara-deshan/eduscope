import { useState } from 'react'
import { Trophy } from 'lucide-react'
import type { Student } from '../../types'
import { useQuestions } from '../../context/QuestionContext'
import { StudentDetailDialog } from './StudentDetailDialog'
import { cn } from '../ui/cn'

/** Simple ranked list: medal, name, X/Y correct, score. Rows open a detail modal. */
export function LeaderboardPanel() {
  const { leaderboard } = useQuestions()
  const [detail, setDetail] = useState<Student | null>(null)

  const ranked = leaderboard.filter((e) => e.answered > 0)

  if (ranked.length === 0) {
    return (
      <div className="us-empty">
        <Trophy size={40} className="us-empty__icon" />
        <p className="us-empty__title">No results yet</p>
        <p className="us-empty__hint">Send a question to the projector to see the class ranking.</p>
      </div>
    )
  }

  return (
    <>
      <ul className="us-ranklist">
        {ranked.map((e, i) => {
          const rank = i + 1
          return (
            <li key={e.student.id}>
              <button className="us-rankrow" onClick={() => setDetail(e.student)}>
                <span
                  className={cn('us-rankmedal', rank <= 3 && `us-rankmedal--${rank}`)}
                  aria-label={`Rank ${rank}`}
                >
                  {rank}
                </span>
                <span className="us-rankrow__meta">
                  <span className="us-rankrow__name">{e.student.name}</span>
                  <span className="us-rankrow__score">
                    {e.correct}/{e.answered} correct
                  </span>
                </span>
                <span className="us-rankrow__points">{e.correct * 10}</span>
              </button>
            </li>
          )
        })}
      </ul>

      <StudentDetailDialog student={detail} onClose={() => setDetail(null)} />
    </>
  )
}
