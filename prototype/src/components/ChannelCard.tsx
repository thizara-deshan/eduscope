import {
  ChevronDown,
  Columns2,
  Files,
  LayoutPanelLeft,
  Monitor,
  Square,
  SquareUser,
} from 'lucide-react'
import type { ChannelId, LayoutPresetId } from '../types'
import { useRecording } from '../context/RecordingContext'
import { layoutsFor } from '../mock/session'
import { Toggle } from './ui/Toggle'
import { CHANNEL_ICONS } from './outputs/channelMeta'
import { cn } from './ui/cn'

interface ChannelCardProps {
  channelId: Extract<ChannelId, 'meeting' | 'streaming'>
  /** Whether the inline layout accordion is expanded. */
  expanded: boolean
  onExpandedChange: (open: boolean) => void
}

const LAYOUT_ICONS: Record<LayoutPresetId, typeof Square> = {
  'fifty-fifty': Columns2,
  'cams-fifty-fifty': Columns2,
  'side-by-side': LayoutPanelLeft,
  'cam-1': Square,
  'cam-2': SquareUser,
  'pc-only': Monitor,
  'separate-files': Files,
}

/**
 * Live Meeting switch card with an inline "MEETING VIEW LAYOUT" accordion.
 * Turning the switch ON expands the layout section (and, via the parent,
 * collapses the right-side insight tabs to free vertical space). The Layouts
 * button lets the lecturer fold the section away while keeping the meeting on.
 */
export function ChannelCard({ channelId, expanded, onExpandedChange }: ChannelCardProps) {
  const { channels, toggleChannel, setChannelPreset } = useRecording()
  const channel = channels.find((c) => c.id === channelId)!
  const on = channel.enabled
  const open = on && expanded
  const layouts = layoutsFor(channelId)

  const handleToggle = () => {
    toggleChannel(channelId)
    onExpandedChange(!on) // turning on → expand; turning off → collapse
  }

  return (
    <section className={cn('us-chcard', on && 'us-chcard--on', open && 'us-chcard--open')}>
      <div className="us-chcard__head">
        <span className={cn('us-chcard__icon', on && 'us-chcard__icon--on')}>
          {CHANNEL_ICONS[channelId](20)}
        </span>
        <span className="us-chcard__meta">
          <span className="us-chcard__name">{channel.name}</span>
          <span className="us-chcard__state">{on ? 'On' : 'Off'}</span>
        </span>

        {on && (
          <button
            className="us-chcard__layouts"
            onClick={() => onExpandedChange(!expanded)}
            aria-expanded={expanded}
          >
            Layouts
            <ChevronDown size={16} className={cn('us-chcard__chev', expanded && 'us-chcard__chev--up')} />
          </button>
        )}

        <Toggle checked={on} onChange={handleToggle} label={channel.name} />
      </div>

      <div className={cn('us-mlayout', open && 'us-mlayout--open')}>
        <div className="us-mlayout__inner">
          <span className="us-mlayout__label">Meeting View Layout</span>
          <div className="us-mlayout__grid">
            {layouts.map(({ id, name }) => {
              const Icon = LAYOUT_ICONS[id]
              return (
                <button
                  key={id}
                  className={cn('us-mlbtn', channel.preset === id && 'us-mlbtn--active')}
                  onClick={() => setChannelPreset(channelId, id)}
                  aria-pressed={channel.preset === id}
                >
                  <Icon size={18} className="us-mlbtn__icon" />
                  {name}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}
