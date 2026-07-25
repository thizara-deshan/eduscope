import { useState } from 'react'
import { ChevronUp, Pause, Play, Square } from 'lucide-react'
import { useRecording } from '../context/RecordingContext'
import { formatTimerHMS } from '../utils/format'
import { cn } from './ui/cn'

/** Right-column session card: big timer digits + Pause/Resume + Stop. */
export function TimerCard() {
  const { status, elapsedSec, pause, resume, stop } = useRecording()
  const [collapsed, setCollapsed] = useState(false)
  const paused = status === 'paused'

  return (
    <section className={cn('us-timercard', collapsed && 'us-timercard--collapsed')}>
      <button
        className="us-timercard__chev"
        onClick={() => setCollapsed((c) => !c)}
        aria-label={collapsed ? 'Expand timer' : 'Collapse timer'}
      >
        <ChevronUp size={16} className={cn(collapsed && 'us-timercard__chevflip')} />
      </button>

      <div className="us-timercard__digits" aria-label="Recording duration">
        {formatTimerHMS(elapsedSec)}
      </div>
      {paused && !collapsed && <span className="us-timercard__pausednote">Recording paused</span>}

      {!collapsed && (
        <div className="us-timercard__actions">
          {paused ? (
            <button className="us-timercard__pause" onClick={resume}>
              <Play size={19} fill="currentColor" />
              Resume
            </button>
          ) : (
            <button className="us-timercard__pause" onClick={pause}>
              <Pause size={19} fill="currentColor" />
              Pause
            </button>
          )}
          <button className="us-timercard__stop" onClick={stop}>
            <Square size={15} fill="currentColor" />
            Stop
          </button>
        </div>
      )}
    </section>
  )
}
