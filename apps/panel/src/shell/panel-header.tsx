import { useAuth } from '../auth/auth-context.js';
import { PanelClock } from './panel-clock.js';
import { UserMenu } from './user-menu.js';
import { useProvisioning } from './use-provisioning.js';
import './shell.css';

/** S-03 header: brand, hall name, clock, user menu. */
export function PanelHeader(): JSX.Element {
  const { user } = useAuth();
  const { hallDisplayName } = useProvisioning();

  return (
    <header className="us-header">
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
      {user && <UserMenu displayName={user.displayName} />}
    </header>
  );
}
