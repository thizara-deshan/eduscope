import type { StreamTarget } from '@eduscope/shared';
import './advanced.css';

export interface StreamTargetListProps {
  readonly targets: readonly StreamTarget[];
  onEdit(target: StreamTarget): void;
  onDeleteClick(target: StreamTarget): void;
}

const PLATFORM_LABELS: Record<StreamTarget['platform'], string> = {
  youtube: 'YouTube',
  facebook: 'Facebook',
  'custom-rtmp': 'Custom RTMP',
};

/** Enabled targets, edit + the existing DangerConfirm delete (wired by the screen). */
export function StreamTargetList({ targets, onEdit, onDeleteClick }: StreamTargetListProps): JSX.Element {
  if (targets.length === 0) {
    return (
      <p className="us-adm__note" data-testid="stream-targets-empty">
        No streaming destinations configured yet — add one below to start broadcasting.
      </p>
    );
  }

  return (
    <div className="us-adm__savedlist" data-testid="stream-target-list">
      {targets.map((target) => (
        <div key={target.id} className="us-adm__targetrow">
          <div>
            <strong>{target.displayName}</strong>
            <div>
              <span className="us-adm__chip">{PLATFORM_LABELS[target.platform]}</span>{' '}
              <span className={`us-adm__chip${target.hasStreamKey ? ' us-adm__chip--configured' : ' us-adm__chip--not-configured'}`}>
                {target.hasStreamKey ? 'Configured' : 'Not configured'}
              </span>
            </div>
          </div>
          <div className="us-adm__inline">
            <button type="button" className="us-adm__secondary" onClick={() => onEdit(target)}>
              Edit
            </button>
            <button type="button" className="us-adm__secondary" onClick={() => onDeleteClick(target)}>
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
