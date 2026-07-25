import { useState } from 'react'
import { Check, MonitorPlay, MonitorX, Tv } from 'lucide-react'
import type { SentQuestion, Student } from '../../types'
import { useQuestions } from '../../context/QuestionContext'
import { getStudent } from '../../mock/students'
import { formatClock } from '../../utils/format'
import { NamesDialog, type NamesTone } from './NamesDialog'
import { cn } from '../ui/cn'

type Category = 'responses' | 'correct' | 'incorrect'

interface BadgeTarget {
  question: SentQuestion
  category: Category
  students: Student[]
}

const TONE: Record<Category, NamesTone> = {
  responses: 'neutral',
  correct: 'correct',
  incorrect: 'incorrect',
}
const LABEL: Record<Category, string> = {
  responses: 'Responses',
  correct: 'Correct',
  incorrect: 'Incorrect',
}

/** Sent-question history with response metrics; badges open a names modal. */
export function SentToProjectorPanel() {
  const { sent, responsesByQuestion, setShowing } = useQuestions()
  const [badge, setBadge] = useState<BadgeTarget | null>(null)

  if (sent.length === 0) {
    return (
      <div className="us-empty">
        <Tv size={40} className="us-empty__icon" />
        <p className="us-empty__title">Nothing sent yet</p>
        <p className="us-empty__hint">Questions you send to the projector are tracked here.</p>
      </div>
    )
  }

  const openBadge = (question: SentQuestion, category: Category) => {
    const responses = responsesByQuestion[question.id] ?? []
    const picked = responses.filter((r) =>
      category === 'responses' ? true : category === 'correct' ? r.correct : !r.correct,
    )
    const students = picked
      .map((r) => getStudent(r.studentId))
      .filter((s): s is Student => Boolean(s))
    setBadge({ question, category, students })
  }

  return (
    <>
      <div className="us-pqlist">
        {sent.map((q) => {
          const responses = responsesByQuestion[q.id] ?? []
          const total = responses.length
          const correct = responses.filter((r) => r.correct).length
          const incorrect = total - correct
          const counts: Record<Category, number> = { responses: total, correct, incorrect }
          return (
            <article key={q.id} className={cn('us-pqcard', q.showing && 'us-pqcard--showing')}>
              <div className="us-pqcard__head">
                {q.showing && (
                  <span className="us-pqcard__badge">
                    <MonitorPlay size={14} /> Now showing
                  </span>
                )}
                <span className="us-pqcard__time">Sent {formatClock(q.sentAt)}</span>
                <button
                  className="us-pqcard__show"
                  onClick={() => setShowing(q.showing ? '' : q.id)}
                  aria-label={q.showing ? 'Hide from projector' : 'Show on projector'}
                >
                  {q.showing ? <MonitorX size={16} /> : <MonitorPlay size={16} />}
                </button>
              </div>

              <p className="us-pqcard__prompt">{q.prompt}</p>
              <p className="us-pqcard__answer">
                <Check size={15} /> {q.options[q.correctIndex]}
              </p>

              <div className="us-pqcard__badges">
                {(['responses', 'correct', 'incorrect'] as Category[]).map((cat) => (
                  <button
                    key={cat}
                    className={cn('us-metric', `us-metric--${cat}`)}
                    onClick={() => openBadge(q, cat)}
                    disabled={counts[cat] === 0}
                  >
                    <span className="us-metric__num">{counts[cat]}</span>
                    {LABEL[cat]}
                  </button>
                ))}
              </div>
            </article>
          )
        })}
      </div>

      <NamesDialog
        open={badge !== null}
        onClose={() => setBadge(null)}
        title={badge ? `${LABEL[badge.category]} — ${badge.students.length}` : ''}
        subtitle={badge?.question.prompt}
        tone={badge ? TONE[badge.category] : 'neutral'}
        students={badge?.students ?? []}
      />
    </>
  )
}
