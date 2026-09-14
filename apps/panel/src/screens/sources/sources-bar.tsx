import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SourceRoleId, SourcesStatusPayload } from '@eduscope/shared';
import { LayoutPreview } from '../../channels/layout-preview.js';
import { useChannelCatalog } from '../../channels/channel-queries.js';
import { useClient } from '../../client/client-provider.js';
import { useOverlays } from '../../overlays/overlay-host.js';
import { useWsShallow } from '../../store/selectors.js';
import { MicRow } from './mic-row.js';
import { PreviewLightbox } from './preview-lightbox.js';
import { SourceTile } from './source-tile.js';
import { usePreview, type PreviewState } from './use-preview.js';
import './sources.css';

export const VIDEO_ROLE_ORDER = ['presentation', 'lecturer-cam', 'students-cam'] as const;

const FALLBACK_LABELS: Record<(typeof VIDEO_ROLE_ORDER)[number], string> = {
  presentation: 'Presentation',
  'lecturer-cam': 'Lecturer Camera',
  'students-cam': 'Students Camera',
};

function frameFrom(state: PreviewState): string | undefined {
  return state.kind === 'live' || state.kind === 'stale' ? state.frame : undefined;
}

function ExpandedSources({
  labelFor,
  statusFor,
  onOpen,
}: {
  readonly labelFor: (roleId: (typeof VIDEO_ROLE_ORDER)[number]) => string;
  readonly statusFor: (roleId: SourceRoleId) => SourcesStatusPayload | undefined;
  readonly onOpen: (roleId: SourceRoleId) => void;
}): JSX.Element {
  const local = useChannelCatalog('local');
  const pc = usePreview('presentation');
  const cam1 = usePreview('lecturer-cam');
  const cam2 = usePreview('students-cam');
  const frames: Partial<Record<SourceRoleId, string>> = {};
  const pcFrame = frameFrom(pc.state);
  const cam1Frame = frameFrom(cam1.state);
  const cam2Frame = frameFrom(cam2.state);
  if (pcFrame) frames.presentation = pcFrame;
  if (cam1Frame) frames['lecturer-cam'] = cam1Frame;
  if (cam2Frame) frames['students-cam'] = cam2Frame;
  const activePreset = local.options.find(({ preset }) => preset.id === local.config?.presetId)?.preset;

  return (
    <div className="us-sources">
      <div className="us-sources__tiles">
        {VIDEO_ROLE_ORDER.map((roleId) => (
          <SourceTile
            key={roleId}
            roleId={roleId}
            displayLabel={labelFor(roleId)}
            status={statusFor(roleId)}
            onOpen={onOpen}
            {...(frames[roleId] ? { previewFrame: frames[roleId] } : {})}
          />
        ))}
      </div>
      <section className="us-sources__active" aria-label="Active layout" data-testid="active-layout">
        {activePreset ? <LayoutPreview preset={activePreset} frames={frames} /> : <div className="us-sources__activeempty" />}
        <span className="us-sources__activelabel">Active layout</span>
      </section>
      <div className="us-sources__divider" aria-hidden="true" />
      <div className="us-sources__mics">
        <MicRow roleId="mic-lecturer" displayName="Lecturer Mic" />
        <MicRow roleId="mic-room" displayName="PC Mic" />
      </div>
    </div>
  );
}

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
  const labelFor = (roleId: (typeof VIDEO_ROLE_ORDER)[number]) =>
    roles.get(roleId)?.displayLabel ?? FALLBACK_LABELS[roleId];
  const openPreview = (roleId: SourceRoleId) => {
    overlays.open(
      <PreviewLightbox
        roleId={roleId}
        label={labelFor(roleId as (typeof VIDEO_ROLE_ORDER)[number])}
      />,
    );
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
        <ExpandedSources labelFor={labelFor} statusFor={sourceStatus} onOpen={openPreview} />
      ) : null}
    </section>
  );
}
