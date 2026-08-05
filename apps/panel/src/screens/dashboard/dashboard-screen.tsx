import { useAuth } from '../../auth/auth-context.js';
import { DangerButton } from '../../danger/danger-button.js';
import { useOverlays } from '../../overlays/overlay-host.js';
import { useProvisioning } from '../../shell/use-provisioning.js';
import { useIsStale, useRecordingSession } from '../../store/selectors.js';
import { RoomControlsBar } from '../room/room-controls-bar.js';
import { SessionLayout } from '../session/session-layout.js';
import { SourcesBar } from '../sources/sources-bar.js';
import { IdleHero } from './idle-hero.js';
import { LockCard } from './lock-card.js';
import { TakeoverConfirm } from './takeover-confirm.js';
import { TakeoverNotice } from './takeover-notice.js';
import { useRecorderLock } from './use-recorder-lock.js';
import { useStartRecording } from './use-start-recording.js';
import './dashboard.css';

function BottomBarSlots(): JSX.Element {
  return (
    <div className="us-dashboard__bars" aria-label="Room controls">
      <div className="us-dashboard__bar-slot" data-testid="sources-bar-slot"><SourcesBar /></div>
      <div className="us-dashboard__bar-slot" data-testid="room-bar-slot"><RoomControlsBar /></div>
    </div>
  );
}

export function DashboardScreen(): JSX.Element {
  const auth = useAuth();
  const provisioning = useProvisioning();
  const start = useStartRecording();
  const lock = useRecorderLock();
  const session = useRecordingSession();
  const stale = useIsStale();
  const overlays = useOverlays();
  const ownerStartPending = lock.kind === 'owned'
    && session?.state === 'starting'
    && (session.startReason === 'initial' || session.startReason === 'recovery');

  if (lock.kind === 'owned' && !ownerStartPending) {
    return (
      <div className="us-dashboard">
        <div className="us-dashboard__main"><SessionLayout /></div>
        <BottomBarSlots />
      </div>
    );
  }

  if (lock.kind === 'takenOver') {
    return (
      <div className="us-dashboard">
        <div className="us-dashboard__main us-takenoversession">
          <TakeoverNotice
            kind="new-owner"
            priorOwnerDisplayName={lock.priorOwnerDisplayName}
            byDisplayName={null}
            at={lock.at}
          />
          <SessionLayout />
        </div>
        <BottomBarSlots />
      </div>
    );
  }

  if ((lock.kind === 'locked' || lock.kind === 'displaced') && session) {
    const openTakeover = () => {
      let overlayId = -1;
      overlayId = overlays.open(
        <TakeoverConfirm onClose={() => overlays.close(overlayId)} />,
        { dismissible: false },
      );
    };
    const isDisplaced = lock.kind === 'displaced';
    const phase = session.state === 'starting'
      ? 'starting'
      : session.state === 'stopping' || session.state === 'finalizing' ? 'ending' : 'live';
    const thirdParty = lock.kind === 'locked' && lock.takenOverByDisplayName !== null;
    const note = isDisplaced
      ? ''
      : thirdParty
        ? `Taken over by ${lock.takenOverByDisplayName}.`
        : lock.kind === 'locked' && lock.phase === 'ending'
          ? 'This lecture is being saved.'
          : lock.kind === 'locked' && lock.canTakeOver
            ? 'You can take over this recording. It keeps recording either way.'
            : `Only ${session.ownerDisplayName ?? 'the lecturer'} or an administrator can stop this recording.`;
    const action = lock.kind === 'locked' && lock.canTakeOver ? (
      <DangerButton variant="quiet" disabled={stale} onClick={openTakeover}>
        Take over
      </DangerButton>
    ) : undefined;

    return (
      <main className="us-dashboard" data-testid="screen" data-screen="S-06" aria-label="Recorder lock">
        <div className="us-lockscreen">
          {isDisplaced ? (
            <TakeoverNotice
              kind="displaced"
              priorOwnerDisplayName={null}
              byDisplayName={lock.byDisplayName}
              at={lock.at}
            />
          ) : null}
          <LockCard
            ownerDisplayName={session.ownerDisplayName}
            title={session.title}
            startedAt={session.startedAt}
            recordedDurationMs={session.recordedDurationMs}
            recordingState={session.state}
            phase={phase}
            note={note}
            stale={stale}
            action={action}
          />
        </div>
        <BottomBarSlots />
      </main>
    );
  }

  return (
    <main
      className="us-dashboard"
      data-testid="screen"
      data-screen="S-04"
      aria-label={provisioning.hallDisplayName
        ? `Dashboard for ${provisioning.hallDisplayName}`
        : 'Dashboard'}
    >
      <IdleHero
        name={auth.user?.displayName ?? 'Lecturer'}
        userRole={auth.role}
        state={start.state}
        onStart={start.start}
        onDismiss={start.dismiss}
      />
      <BottomBarSlots />
    </main>
  );
}
