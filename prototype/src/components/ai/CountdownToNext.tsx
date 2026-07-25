import { CalendarClock, Zap } from 'lucide-react'
import type { IntervalMinutes } from '../../types'
import { useQuestions } from '../../context/QuestionContext'
import { useRecording } from '../../context/RecordingContext'

const INTERVALS: IntervalMinutes[] = [10, 15, 20, 30]

/**
 * The AI Studio default view: an automatic side ("Generate questions every
 * [N]") and a manual side ("Generate Questions Now"), split by an OR divider.
 * The manual button hands off to the questions modal via `onGenerateNow`.
 */
export function GenerateControls({ onGenerateNow }: { onGenerateNow: () => void }) {
  const { intervalMinutes, setIntervalMinutes, generating } = useQuestions()
  const { status } = useRecording()
  const active = status === 'recording'

  return (
    <div className="us-studio__generate">
      <div className="us-genside">
        <span className="us-genside__icon">
          <CalendarClock size={22} />
        </span>
        <span className="us-genside__title">Generate questions every</span>
        <select
          className="us-genside__select"
          value={intervalMinutes}
          onChange={(e) => setIntervalMinutes(Number(e.target.value) as IntervalMinutes)}
          aria-label="Auto-generation interval"
        >
          {INTERVALS.map((m) => (
            <option key={m} value={m}>
              {m} Minutes
            </option>
          ))}
        </select>
        <span className="us-genside__hint">Questions appear automatically.</span>
      </div>

      <div className="us-studio__or">
        <span className="us-studio__orline" />
        <span className="us-studio__ortext">OR</span>
        <span className="us-studio__orline" />
      </div>

      <div className="us-genside">
        <span className="us-genside__icon">
          <Zap size={22} />
        </span>
        <span className="us-genside__title">Generate now</span>
        <button
          className="us-genbtn"
          onClick={onGenerateNow}
          disabled={!active || generating}
        >
          <Zap size={18} fill="currentColor" />
          {generating ? 'Generating…' : 'Generate Questions Now'}
        </button>
        <span className="us-genside__hint">From everything taught so far.</span>
      </div>
    </div>
  )
}
