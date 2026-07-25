import { useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  Lightbulb,
  Mic,
  Minus,
  Plus,
  Presentation,
  Projector,
  SlidersHorizontal,
  Snowflake,
  Volume2,
} from 'lucide-react'
import { useRecording } from '../../context/RecordingContext'
import { Toggle } from '../ui/Toggle'
import { cn } from '../ui/cn'

interface RoomControlsPanelProps {
  open: boolean
  onToggle: () => void
  /** Only admins see the Advanced (System Administration) entry. */
  showAdvanced: boolean
  onOpenAdvanced: () => void
}

/**
 * Bottom collapsible: in-room hardware controls grouped as Projector / Audio /
 * Environment (all mock, local state). The master Microphones switch drives
 * the real mic mute state so the sources panel meters react.
 */
export function RoomControlsPanel({
  open,
  onToggle,
  showAdvanced,
  onOpenAdvanced,
}: RoomControlsPanelProps) {
  const { mics, setAllMuted } = useRecording()
  const micsLive = mics.some((m) => !m.muted)

  const [projectorOn, setProjectorOn] = useState(true)
  const [screenLowered, setScreenLowered] = useState(false)
  const [speakerVol, setSpeakerVol] = useState(50)
  const [lightsOn, setLightsOn] = useState(true)
  const [acOn, setAcOn] = useState(true)
  const [acTemp, setAcTemp] = useState(22)

  return (
    <section className={cn('us-panelbar', open && 'us-panelbar--open')}>
      <header className="us-panelbar__head">
        <span className="us-panelbar__title">Room controls</span>
        <div className="us-panelbar__headactions">
          {showAdvanced && (
            <button className="us-panelbar__adv" onClick={onOpenAdvanced}>
              <SlidersHorizontal size={16} />
              Advanced
            </button>
          )}
          <button className="us-panelbar__toggle" onClick={onToggle}>
            {open ? 'Collapse' : 'Show controls'}
            {open ? <ChevronDown size={17} /> : <ChevronUp size={17} />}
          </button>
        </div>
      </header>

      {open && (
        <div className="us-room">
          {/* Projector */}
          <div className="us-roomgroup">
            <span className="us-roomgroup__title">Projector</span>
            <div className="us-roomrow">
              <span className="us-roomrow__icon">
                <Projector size={19} />
              </span>
              <span className="us-roomrow__meta">
                <span className="us-roomrow__name">Projector</span>
                <span className="us-roomrow__state">{projectorOn ? 'On' : 'Off'}</span>
              </span>
              <Toggle checked={projectorOn} onChange={() => setProjectorOn((v) => !v)} label="Projector" />
            </div>
            <div className="us-roomrow">
              <span className="us-roomrow__icon">
                <Presentation size={19} />
              </span>
              <span className="us-roomrow__meta">
                <span className="us-roomrow__name">Projector Screen</span>
                <span className="us-roomrow__state">{screenLowered ? 'Lowered' : 'Raised'}</span>
              </span>
              <Toggle
                checked={screenLowered}
                onChange={() => setScreenLowered((v) => !v)}
                label="Projector screen"
              />
            </div>
          </div>

          {/* Audio */}
          <div className="us-roomgroup">
            <span className="us-roomgroup__title">Audio</span>
            <div className="us-roomrow">
              <span className="us-roomrow__icon">
                <Volume2 size={19} />
              </span>
              <span className="us-roomrow__meta">
                <span className="us-roomrow__name">Speaker Volume</span>
              </span>
              <div className="us-roomrow__stepgroup">
                <button
                  className="us-stepper"
                  onClick={() => setSpeakerVol((v) => Math.max(0, v - 5))}
                  aria-label="Decrease speaker volume"
                >
                  <Minus size={17} />
                </button>
                <span className="us-roomrow__value">{speakerVol}%</span>
                <button
                  className="us-stepper"
                  onClick={() => setSpeakerVol((v) => Math.min(100, v + 5))}
                  aria-label="Increase speaker volume"
                >
                  <Plus size={17} />
                </button>
              </div>
            </div>
            <div className="us-roomrow">
              <span className="us-roomrow__icon">
                <Mic size={19} />
              </span>
              <span className="us-roomrow__meta">
                <span className="us-roomrow__name">Lecturer Mic</span>
                <span className="us-roomrow__state">{micsLive ? 'Live' : 'Muted'}</span>
              </span>
              <Toggle
                checked={micsLive}
                onChange={() => setAllMuted(micsLive)}
                label="Lecturer Mic"
              />
            </div>
          </div>

          {/* Environment */}
          <div className="us-roomgroup">
            <span className="us-roomgroup__title">Environment</span>
            <div className="us-roomrow">
              <span className="us-roomrow__icon">
                <Lightbulb size={19} />
              </span>
              <span className="us-roomrow__meta">
                <span className="us-roomrow__name">Lights</span>
                <span className="us-roomrow__state">{lightsOn ? 'On' : 'Off'}</span>
              </span>
              <Toggle checked={lightsOn} onChange={() => setLightsOn((v) => !v)} label="Lights" />
            </div>
            <div className="us-roomrow">
              <span className="us-roomrow__icon">
                <Snowflake size={19} />
              </span>
              <span className="us-roomrow__meta">
                <span className="us-roomrow__name">A/C</span>
                <span className="us-roomrow__state">{acOn ? 'On' : 'Off'}</span>
              </span>
              <div className="us-roomrow__stepgroup">
                <button
                  className="us-stepper"
                  onClick={() => setAcTemp((t) => Math.max(16, t - 1))}
                  aria-label="Decrease temperature"
                >
                  <Minus size={17} />
                </button>
                <span className="us-roomrow__value">{acTemp}°C</span>
                <button
                  className="us-stepper"
                  onClick={() => setAcTemp((t) => Math.min(30, t + 1))}
                  aria-label="Increase temperature"
                >
                  <Plus size={17} />
                </button>
              </div>
              <Toggle checked={acOn} onChange={() => setAcOn((v) => !v)} label="Air conditioning" />
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
