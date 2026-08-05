import type { SourceRoleId, SourcesStatusPayload } from '@eduscope/shared';
import { useOverlays } from '../../overlays/overlay-host.js';
import { useRecordingState, useWsShallow } from '../../store/selectors.js';

const VIDEO_ROLES = ['presentation', 'lecturer-cam', 'students-cam'] as const;

const ROLE_LABELS: Record<(typeof VIDEO_ROLES)[number], string> = {
  presentation: 'PC',
  'lecturer-cam': 'CAM 1',
  'students-cam': 'CAM 2',
};

const HEALTH_WORDS: Record<SourcesStatusPayload['state'], string> = {
  online: 'Live',
  degraded: 'Reconnecting',
  offline: 'No signal',
  unknown: 'Checking',
  unbound: 'Unbound',
};

function SourceTile({
  roleId,
  source,
  dense,
  frozen,
  onPreview,
}: {
  readonly roleId: (typeof VIDEO_ROLES)[number];
  readonly source: SourcesStatusPayload | undefined;
  readonly dense: boolean;
  readonly frozen: boolean;
  readonly onPreview: (roleId: SourceRoleId) => void;
}) {
  if (source?.state === 'unbound') return null;
  const state = source?.state ?? 'unknown';
  const health = HEALTH_WORDS[state];
  const unavailable = frozen || state === 'offline' || state === 'unknown';

  return (
    <button
      type="button"
      className={`us-capturesource us-capturesource--${state}`}
      data-testid="capture-source-tile"
      data-role={roleId}
      data-density={dense ? 'dense' : 'comfortable'}
      aria-label={health}
      aria-disabled={unavailable || undefined}
      disabled={unavailable}
      onClick={() => onPreview(roleId)}
    >
      <span className="us-capturesource__image" aria-hidden="true">
        <span className="us-capturesource__overlay-label">{ROLE_LABELS[roleId]}</span>
      </span>
      <span className="us-capturesource__caption">
        <span className="us-capturesource__role">{ROLE_LABELS[roleId]}</span>
        <span className="us-capturesource__health">{health}</span>
      </span>
    </button>
  );
}

export function CaptureSourcesRow({ dense }: { readonly dense: boolean }): JSX.Element {
  const sources = useWsShallow((state) => state.sources);
  const recordingState = useRecordingState();
  const overlays = useOverlays();
  const frozen = recordingState === 'stopping' || recordingState === 'finalizing';

  const handlePreview = (roleId: SourceRoleId) => {
    // Task 16 replaces this no-op with the S-10 lightbox node.
    void overlays;
    void roleId;
  };

  return (
    <section className="us-captureblock" data-testid="capture-sources" aria-labelledby="capture-sources-label">
      <h2 className="us-captureblock__label" id="capture-sources-label">CAPTURING</h2>
      <div className="us-capturesources__row">
        {VIDEO_ROLES.map((roleId) => (
          <SourceTile
            key={roleId}
            roleId={roleId}
            source={sources[roleId]}
            dense={dense}
            frozen={frozen}
            onPreview={handlePreview}
          />
        ))}
      </div>
    </section>
  );
}
