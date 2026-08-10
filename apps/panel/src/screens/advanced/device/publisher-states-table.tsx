import type { PublisherState } from '@eduscope/shared';

interface PublisherStatesTableProps {
  readonly states: Record<string, PublisherState>;
}

/** S-36 §2.1/§3 DI-D-4 — per-SourceRoleId PROCESS status (distinct from S-09's source/frames view). */
export function PublisherStatesTable({ states }: PublisherStatesTableProps): JSX.Element {
  const rows = Object.entries(states);

  return (
    <div className="us-device__publishers" aria-label="Publishers (device-lifetime processes)">
      {rows.length === 0 ? (
        <p className="us-adm__note">No publisher processes reported.</p>
      ) : (
        rows.map(([roleId, state]) => (
          <div key={roleId} className="us-device__publisherrow">
            <span className={`us-device__dot us-device__dot--${state.status === 'running' ? 'on' : 'danger'}`} aria-hidden="true" />
            <span className="us-device__label">{roleId}</span>
            <span className="us-device__value">{state.status}</span>
            <span className="us-device__label">since {new Date(state.since).toLocaleTimeString()}</span>
            {state.lastErrorCode ? (
              <span className="us-device__value us-device__value--mono us-device__err">err: {state.lastErrorCode}</span>
            ) : null}
          </div>
        ))
      )}
    </div>
  );
}
