import { UserRound } from 'lucide-react'
import type { LayoutPresetId } from '../../types'
import { SOURCES } from '../../mock/session'
import { cn } from '../ui/cn'

interface LayoutPreviewProps {
  preset: LayoutPresetId
  /** Compact renders the small thumbnail used inside the picker. */
  compact?: boolean
  /** Large renders the detailed per-channel output preview. */
  large?: boolean
}

type TileKind = 'cam' | 'pc'

function Tile({
  label,
  kind,
  className,
  compact,
}: {
  label: string
  kind: TileKind
  className?: string
  compact?: boolean
}) {
  return (
    <div className={cn('us-lp__tile', `us-lp__tile--${kind}`, className)}>
      {kind === 'cam' ? (
        <div className="us-lp__cam">
          <UserRound className="us-lp__silhouette" />
        </div>
      ) : (
        <div className="us-lp__pc">
          <span className="us-lp__slideline us-lp__slideline--title" />
          <span className="us-lp__slideline" />
          <span className="us-lp__slideline" />
          <span className="us-lp__slideline us-lp__slideline--short" />
        </div>
      )}
      {!compact && (
        <span className="us-lp__label">
          <span className="us-lp__livedot" />
          {label}
        </span>
      )}
    </div>
  )
}

/** Renders a layout preset as mock CAM / PC feeds (no real video). */
export function LayoutPreview({ preset, compact, large }: LayoutPreviewProps) {
  return (
    <div className={cn('us-lp', compact && 'us-lp--compact', large && 'us-lp--large')}>
      {preset === 'fifty-fifty' && (
        <div className="us-lp__row">
          <Tile label={SOURCES.pc} kind="pc" className="us-lp__tile--half" compact={compact} />
          <Tile label={SOURCES.cam1} kind="cam" className="us-lp__tile--half" compact={compact} />
        </div>
      )}
      {preset === 'cams-fifty-fifty' && (
        <div className="us-lp__row">
          <Tile label={SOURCES.cam1} kind="cam" className="us-lp__tile--half" compact={compact} />
          <Tile label={SOURCES.cam2} kind="cam" className="us-lp__tile--half" compact={compact} />
        </div>
      )}
      {preset === 'pc-only' && (
        <Tile label={SOURCES.pc} kind="pc" className="us-lp__tile--full" compact={compact} />
      )}
      {/* Two independent recordings rather than one composed frame. */}
      {preset === 'separate-files' && (
        <div className="us-lp__row us-lp__row--split">
          <Tile
            label={`${SOURCES.pc} · file 1`}
            kind="pc"
            className="us-lp__tile--half"
            compact={compact}
          />
          <Tile
            label={`${SOURCES.cam1} · file 2`}
            kind="cam"
            className="us-lp__tile--half"
            compact={compact}
          />
        </div>
      )}
      {preset === 'side-by-side' && (
        <div className="us-lp__row">
          <Tile label={SOURCES.cam1} kind="cam" className="us-lp__tile--wide" compact={compact} />
          <Tile label={SOURCES.cam2} kind="cam" className="us-lp__tile--narrow" compact={compact} />
        </div>
      )}
      {preset === 'cam-1' && (
        <Tile label={SOURCES.cam1} kind="cam" className="us-lp__tile--full" compact={compact} />
      )}
      {preset === 'cam-2' && (
        <Tile label={SOURCES.cam2} kind="cam" className="us-lp__tile--full" compact={compact} />
      )}
    </div>
  )
}
