import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SourceRoleId, SourcesStatusPayload } from '@eduscope/shared';
import { useClient } from '../../client/client-provider.js';
import { useOverlays } from '../../overlays/overlay-host.js';
import { useWsShallow } from '../../store/selectors.js';
import { SourceTile } from './source-tile.js';
import './sources.css';

export const VIDEO_ROLE_ORDER = ['presentation', 'lecturer-cam', 'students-cam'] as const;

const FALLBACK_LABELS: Record<(typeof VIDEO_ROLE_ORDER)[number], string> = {
  presentation: 'Presentation',
  'lecturer-cam': 'Lecturer Camera',
  'students-cam': 'Students Camera',
};

export function SourcesBar(): JSX.Element {
  const client = useClient();
  const overlays = useOverlays();
  const liveSources = useWsShallow((state) => state.sources);
  const [open, setOpen] = useState(false);
  const rolesQuery = useQuery({
    queryKey: ['source-roles'],
    queryFn: () => client.listSourceRoles(),
  });
  const statusQuery = useQuery({
    queryKey: ['source-status'],
    queryFn: () => client.getSourcesStatus(),
  });
  const roles = useMemo(
    () => new Map(rolesQuery.data?.map((role) => [role.id, role])),
    [rolesQuery.data],
  );
  const restStatuses = useMemo(
    () => new Map(statusQuery.data?.map((status) => [status.roleId, status])),
    [statusQuery.data],
  );
  const sourceStatus = (roleId: SourceRoleId): SourcesStatusPayload | undefined =>
    liveSources[roleId] ?? restStatuses.get(roleId);
  const openPreview = (roleId: SourceRoleId) => {
    // Task 16 supplies the S-10 overlay node.
    void overlays;
    void roleId;
  };

  return (
    <section
      className={`us-panelbar${open ? ' us-panelbar--open' : ''}`}
      data-testid="sources-bar"
      aria-label="Live video sources and audio sources"
    >
      <header className="us-panelbar__head">
        <span className="us-panelbar__title">
          Live video sources and audio sources
          {!open ? (
            <span className="us-panelbar__dots" aria-label="Video source health">
              {VIDEO_ROLE_ORDER.map((roleId) => {
                const state = sourceStatus(roleId)?.state ?? 'unknown';
                return state === 'unbound' ? null : (
                  <span key={roleId} className="us-panelbar__dot" data-testid="source-dot" data-state={state} />
                );
              })}
            </span>
          ) : null}
        </span>
        <button type="button" className="us-panelbar__toggle" onClick={() => setOpen((value) => !value)}>
          {open ? 'Collapse' : 'Show sources'}
        </button>
      </header>
      {open ? (
        <div className="us-sources">
          <div className="us-sources__tiles">
            {VIDEO_ROLE_ORDER.map((roleId) => (
              <SourceTile
                key={roleId}
                roleId={roleId}
                displayLabel={roles.get(roleId)?.displayLabel ?? FALLBACK_LABELS[roleId]}
                status={sourceStatus(roleId)}
                onOpen={openPreview}
              />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
