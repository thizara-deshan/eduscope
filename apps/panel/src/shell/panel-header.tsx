import { useAuth } from '../auth/auth-context.js';
import { useRecordingState } from '../store/selectors.js';
import { NotificationCenter } from './notification-center.js';
import { PanelClock } from './panel-clock.js';
import { UserMenu } from './user-menu.js';
import { useProvisioning } from './use-provisioning.js';
import './shell.css';

/** S-03 header: brand, hall name, clock, user menu. */
export function PanelHeader(): JSX.Element {
  const { user } = useAuth();
  const { hallDisplayName } = useProvisioning();
  const recordingState = useRecordingState();
  const recordingActive = recordingState === 'recording' || recordingState === 'paused'
    || recordingState === 'stopping' || recordingState === 'finalizing';

  return (
    <header className="us-header" data-recording-active={recordingActive}>
      <div className="us-header__brand">
        <span className="us-header__logo">Eduscope</span>
        {hallDisplayName && (
          <>
            <span className="us-header__divider" aria-hidden="true" />
            <span className="us-header__hall">{hallDisplayName}</span>
          </>
        )}
      </div>
      <PanelClock />
      <NotificationCenter />
      {user && <UserMenu displayName={user.displayName} />}
    </header>
  );
}
