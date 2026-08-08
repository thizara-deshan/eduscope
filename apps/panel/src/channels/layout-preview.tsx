import type { CSSProperties } from 'react';
import type { LayoutPreset, OutputSpec, SourceRoleId, Tile } from '@eduscope/shared';
import './channels.css';

const ROLE_LABELS: Partial<Record<SourceRoleId, string>> = {
  presentation: 'Presentation',
  'lecturer-cam': 'Lecturer Camera',
  'students-cam': 'Students Camera',
};

const ROLE_KIND: Partial<Record<SourceRoleId, 'pc' | 'cam'>> = {
  presentation: 'pc',
  'lecturer-cam': 'cam',
  'students-cam': 'cam',
};

function labelFor(roleId: SourceRoleId): string {
  return ROLE_LABELS[roleId] ?? roleId;
}

interface FrameProps {
  readonly roleId: SourceRoleId;
  readonly label: string;
  readonly compact?: boolean | undefined;
  readonly style?: CSSProperties | undefined;
}

/** The existing PC/camera visual vocabulary (prototype `outputs/LayoutPreview.tsx`), driven by role id rather than a preset switch. */
function Frame({ roleId, label, compact, style }: FrameProps): JSX.Element {
  const kind = ROLE_KIND[roleId] ?? 'cam';
  return (
    <div className={`us-lp__tile us-lp__tile--${kind}`} style={style}>
      {kind === 'cam' ? (
        <div className="us-lp__cam">
          <div className="us-lp__silhouette" />
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
  );
}

export interface LayoutPreviewProps {
  readonly preset: LayoutPreset;
  /** Compact renders the small thumbnail used inside the picker. */
  readonly compact?: boolean;
  /** Large renders the detailed per-channel output preview. */
  readonly large?: boolean;
}

function tileStyle(tile: Tile, canvas: { readonly width: number; readonly height: number }): CSSProperties {
  return {
    position: 'absolute',
    left: `${(tile.x / canvas.width) * 100}%`,
    top: `${(tile.y / canvas.height) * 100}%`,
    width: `${(tile.w / canvas.width) * 100}%`,
    height: `${(tile.h / canvas.height) * 100}%`,
    zIndex: tile.z,
  };
}

function fileCount(output: OutputSpec, index: number): string {
  return `${labelFor(output.roleIds[0] ?? 'presentation')} · file ${index + 1}`;
}

/**
 * Renders any `LayoutPreset` from its own `tiles`/`outputs` data — no
 * preset-id branch (INV-LP-2, W3 plan). `single`/`composite` position tiles
 * as percentages of `canvas`; `multi-file` renders one labelled frame per
 * `outputs` entry, never overlapping full-canvas tiles.
 */
export function LayoutPreview({ preset, compact, large }: LayoutPreviewProps): JSX.Element {
  const classes = ['us-lp', compact && 'us-lp--compact', large && 'us-lp--large'].filter(Boolean).join(' ');

  if (preset.kind === 'multi-file') {
    return (
      <div className={classes} data-testid="layout-preview" data-kind="multi-file">
        <div className="us-lp__row us-lp__row--split">
          {preset.outputs.map((output, index) => (
            <Frame
              key={output.streamKey}
              roleId={output.roleIds[0] ?? 'presentation'}
              label={fileCount(output, index)}
              compact={compact}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={classes} data-testid="layout-preview" data-kind={preset.kind}>
      <div className="us-lp__canvas">
        {preset.tiles.map((tile) => (
          <Frame
            key={`${tile.roleId}-${tile.x}-${tile.y}`}
            roleId={tile.roleId}
            label={labelFor(tile.roleId)}
            compact={compact}
            style={tileStyle(tile, preset.canvas)}
          />
        ))}
      </div>
    </div>
  );
}
