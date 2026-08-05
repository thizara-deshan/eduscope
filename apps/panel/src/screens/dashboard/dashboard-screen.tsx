import { useAuth } from '../../auth/auth-context.js';
import { useProvisioning } from '../../shell/use-provisioning.js';
import { useRecordingState } from '../../store/selectors.js';
import { SessionLayout } from '../session/session-layout.js';
import { IdleHero } from './idle-hero.js';
import { useStartRecording } from './use-start-recording.js';
import './dashboard.css';

export function DashboardScreen(): JSX.Element {
  const auth = useAuth();
  const provisioning = useProvisioning();
  const start = useStartRecording();
  const recordingState = useRecordingState();
  const isLiveSession = recordingState === 'starting'
    || recordingState === 'recording'
    || recordingState === 'paused'
    || recordingState === 'stopping'
    || recordingState === 'finalizing';

  if (isLiveSession) return <SessionLayout />;

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
      <div className="us-dashboard__bars" aria-label="Room controls">
        <div className="us-dashboard__bar-slot" data-testid="sources-bar-slot" />
        <div className="us-dashboard__bar-slot" data-testid="room-bar-slot" />
      </div>
    </main>
  );
}
