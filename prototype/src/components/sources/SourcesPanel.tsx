import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, Minus, Plus, UserRound } from 'lucide-react'
import { useRecording } from '../../context/RecordingContext'
import { VIDEO_SOURCES, type VideoSource } from '../../mock/session'
import { Modal } from '../ui/Modal'
import { cn } from '../ui/cn'

const SEGMENTS = 20

/**
 * Mock mic levels: while recording and unmuted, a smooth random walk around
 * the gain baseline; otherwise the meter shows the gain setting statically.
 * setState runs inside the interval callback, keeping the effect rule happy.
 */
function useMicLevels(active: boolean): Record<string, number> {
  const { mics } = useRecording()
  const [levels, setLevels] = useState<Record<string, number>>({})
  useEffect(() => {
    const timer = window.setInterval(() => {
      setLevels((prev) => {
        const next: Record<string, number> = {}
        for (const m of mics) {
          if (m.muted) {
            next[m.id] = 0
            continue
          }
          if (!active) {
            next[m.id] = m.gain / 100
            continue
          }
          const baseline = 0.15 + (m.gain / 100) * 0.65
          const jitter = (Math.random() - 0.5) * 0.5
          const target = Math.min(1, Math.max(0.05, baseline + jitter))
          const prevVal = prev[m.id] ?? 0
          next[m.id] = prevVal + (target - prevVal) * 0.55
        }
        return next
      })
    }, 110)
    return () => window.clearInterval(timer)
  }, [mics, active])
  return levels
}

/** A single mock feed: slide deck for HDMI, presenter silhouette for cameras. */
function SourceFeed({ kind, large }: { kind: VideoSource['kind']; large?: boolean }) {
  return (
    <div className={cn('us-feed', `us-feed--${kind}`, large && 'us-feed--large')}>
      {kind === 'cam' ? (
        <UserRound className="us-feed__silhouette" />
      ) : (
        <div className="us-feed__slide">
          <span className="us-feed__line us-feed__line--title" />
          <span className="us-feed__line" />
          <span className="us-feed__line" />
          <span className="us-feed__line us-feed__line--short" />
        </div>
      )}
    </div>
  )
}

interface SourcesPanelProps {
  open: boolean
  onToggle: () => void
}

/** Bottom collapsible: live source previews + mic meters with gain steppers. */
export function SourcesPanel({ open, onToggle }: SourcesPanelProps) {
  const { mics, setGain, status } = useRecording()
  const levels = useMicLevels(status === 'recording')
  const [expanded, setExpanded] = useState<VideoSource | null>(null)

  return (
    <section className={cn('us-panelbar', open && 'us-panelbar--open')}>
      <header className="us-panelbar__head">
        <span className="us-panelbar__title">
          Live video sources and audio sources
          {!open && (
            <span className="us-panelbar__dots" aria-label="3 sources live">
              {VIDEO_SOURCES.map((s) => (
                <span key={s.id} className="us-panelbar__dot" />
              ))}
            </span>
          )}
        </span>
        <button className="us-panelbar__toggle" onClick={onToggle}>
          {open ? 'Collapse' : 'Show sources'}
          {open ? <ChevronDown size={17} /> : <ChevronUp size={17} />}
        </button>
      </header>

      {open && (
        <div className="us-sources">
          <div className="us-sources__tiles">
            {VIDEO_SOURCES.map((src) => (
              <button
                key={src.id}
                className="us-srctile"
                onClick={() => setExpanded(src)}
                aria-label={`Expand ${src.label}`}
              >
                <SourceFeed kind={src.kind} />
                <span className="us-srctile__label">{src.label}</span>
                <span className="us-srctile__live" aria-hidden="true" />
              </button>
            ))}
          </div>

          <div className="us-sources__divider" />

          <div className="us-sources__mics">
            {mics.map((m) => {
              const lit = m.muted ? 0 : Math.round((levels[m.id] ?? 0) * SEGMENTS)
              return (
                <div key={m.id} className="us-srcmic">
                  <span className="us-srcmic__name">{m.name}</span>
                  <div className="us-srcmic__meter" aria-hidden="true">
                    {Array.from({ length: SEGMENTS }, (_, i) => (
                      <span
                        key={i}
                        className={cn('us-srcmic__seg', i < lit && 'us-srcmic__seg--on')}
                      />
                    ))}
                  </div>
                  <button
                    className="us-stepper"
                    onClick={() => setGain(m.id, Math.max(0, m.gain - 5))}
                    aria-label={`Decrease ${m.name} level`}
                  >
                    <Minus size={17} />
                  </button>
                  <span className="us-srcmic__pct">{m.muted ? 'Muted' : `${m.gain}%`}</span>
                  <button
                    className="us-stepper"
                    onClick={() => setGain(m.id, Math.min(100, m.gain + 5))}
                    aria-label={`Increase ${m.name} level`}
                  >
                    <Plus size={17} />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <Modal
        open={expanded !== null}
        onClose={() => setExpanded(null)}
        title={expanded?.label ?? ''}
        subtitle="Live preview"
      >
        {expanded && (
          <div className="us-lightbox">
            <SourceFeed kind={expanded.kind} large />
            <span className="us-lightbox__live">
              <span className="us-srctile__live" /> LIVE
            </span>
          </div>
        )}
      </Modal>
    </section>
  )
}
