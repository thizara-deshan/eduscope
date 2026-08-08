import type { ChannelConfig, LayoutPresetId, Problem } from '@eduscope/shared';
import type { ChannelPresetOption } from './channel-queries.js';
import { LayoutPreview } from './layout-preview.js';
import './channels.css';

export interface LayoutPresetPickerProps {
  readonly options: readonly ChannelPresetOption[];
  readonly config: ChannelConfig | undefined;
  readonly phase: 'idle' | 'saving' | 'applied' | 'refused';
  readonly problem: Problem | null;
  /** The preset id the last `onSelect` tap requested — only that card shows "Saving…" while `phase === 'saving'`. */
  readonly pendingPresetId: LayoutPresetId | null;
  onSelect(presetId: LayoutPresetId): void;
}

/**
 * Shared accessible preset grid for S-08/S-26/S-27. `aria-pressed` tracks the
 * applied config (never the tap), only the tapped card shows "Saving…", and
 * the applied/refused messages live in polite live regions next to the grid.
 */
export function LayoutPresetPicker({
  options, config, phase, problem, pendingPresetId, onSelect,
}: LayoutPresetPickerProps): JSX.Element {
  return (
    <div>
      <div className="us-presetgrid" data-testid="layout-preset-picker">
        {options.map(({ preset, disabled, reason }) => {
          const selected = preset.id === config?.presetId;
          const isSavingThis = phase === 'saving' && preset.id === pendingPresetId;
          return (
            <button
              key={preset.id}
              type="button"
              className={`us-presetcard${selected ? ' us-presetcard--selected' : ''}`}
              onClick={() => onSelect(preset.id)}
              disabled={disabled}
              aria-disabled={disabled}
              aria-pressed={selected}
            >
              {selected && <span className="us-presetcard__check" aria-hidden="true">✓</span>}
              <LayoutPreview preset={preset} compact />
              <span className="us-presetcard__name">{preset.displayName}</span>
              <span className="us-presetcard__desc">
                {disabled && reason ? reason : preset.description}
              </span>
              {isSavingThis && <span className="us-presetcard__saving">Saving…</span>}
            </button>
          );
        })}
      </div>
      <div aria-live="polite" className="us-presetgrid__status">
        {phase === 'applied' && 'Layout applied.'}
      </div>
      <div aria-live="polite" className="us-presetgrid__status us-presetgrid__status--error">
        {phase === 'refused' && (problem?.title ?? 'This layout could not be applied.')}
      </div>
    </div>
  );
}
