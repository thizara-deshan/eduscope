import type { SourceRoleId, SourcesStatusPayload } from '@eduscope/shared';
import { useIsStale } from '../../store/selectors.js';
import './sources.css';

const HEALTH_WORDS: Record<SourcesStatusPayload['state'], string> = {
  online: 'Live',
  degraded: 'reconnecting…',
  offline: 'No signal',
  unknown: 'checking…',
  unbound: 'Not installed',
};

export function SourceTile({
  roleId,
  displayLabel,
  status,
  onOpen,
  previewFrame,
}: {
  readonly roleId: SourceRoleId;
  readonly displayLabel: string;
  readonly status: SourcesStatusPayload | undefined;
  readonly onOpen: (roleId: SourceRoleId) => void;
  readonly previewFrame?: string;
}): JSX.Element | null {
  const stale = useIsStale();
  const state = status?.state ?? 'unknown';
  if (state === 'unbound') return null;
  const health = HEALTH_WORDS[state];
  const disabled = stale || state === 'offline' || state === 'unknown';

  return (
    <button
      type="button"
      className={`us-srctile us-srctile--${state}`}
      data-testid="source-tile"
      data-role={roleId}
      data-state={state}
      data-stale={stale || undefined}
      aria-label={health}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      onClick={() => onOpen(roleId)}
    >
      {previewFrame ? (
        <img className="us-srctile__frame" src={previewFrame} alt="" data-testid="source-tile-preview" />
      ) : (
        <span className="us-srctile__fill" aria-hidden="true" />
      )}
      <span className="us-srctile__label">{displayLabel}</span>
      <span className="us-srctile__health">{health}</span>
      <span className="us-srctile__live" aria-hidden="true" />
    </button>
  );
}
