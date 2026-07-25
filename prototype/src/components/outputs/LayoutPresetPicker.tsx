import { Check } from 'lucide-react'
import type { ChannelId, LayoutPresetId } from '../../types'
import { layoutsFor } from '../../mock/session'
import { LayoutPreview } from './LayoutPreview'
import { cn } from '../ui/cn'

interface LayoutPresetPickerProps {
  /** Only the layouts this channel offers are shown. */
  channelId: ChannelId
  value: LayoutPresetId
  onChange: (preset: LayoutPresetId) => void
}

/** Grid of tappable preset thumbnails with a selected indicator. */
export function LayoutPresetPicker({ channelId, value, onChange }: LayoutPresetPickerProps) {
  return (
    <div className="us-presetgrid">
      {layoutsFor(channelId).map((preset) => {
        const selected = preset.id === value
        return (
          <button
            key={preset.id}
            type="button"
            className={cn('us-presetcard', selected && 'us-presetcard--selected')}
            onClick={() => onChange(preset.id)}
            aria-pressed={selected}
          >
            {selected && (
              <span className="us-presetcard__check">
                <Check size={15} />
              </span>
            )}
            <LayoutPreview preset={preset.id} compact />
            <span className="us-presetcard__name">{preset.name}</span>
            <span className="us-presetcard__desc">{preset.description}</span>
          </button>
        )
      })}
    </div>
  )
}
