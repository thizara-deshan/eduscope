import { IdentityCard } from './identity-card.js';
import { FeatureFlagsPanel } from './feature-flags-panel.js';
import { TimeClockCard } from './time-clock-card.js';
import { DeviceHealthCard } from './device-health-card.js';
import { AlertList } from './alert-list.js';
import { useProvisioning } from './use-provisioning.js';
import { useDeviceHealth } from './use-device-health.js';
import { useIsStale } from '../../../store/selectors.js';
import './device.css';

/** S-36 — the admin status sheet (S-36-design §2): a stacked column, no edit affordances (C-1). */
export function DeviceIdentityScreen(): JSX.Element {
  const { provisioning, loading, missingFields } = useProvisioning();
  const { health, isStale } = useDeviceHealth();
  const wsStale = useIsStale();
  const notProvisioned = missingFields.length > 0;

  if (loading || !provisioning) {
    return (
      <section className="us-device" data-testid="screen" data-screen="S-36" aria-busy="true">
        <header className="us-adm__pagehead">
          <div>
            <h1>Device &amp; Identity</h1>
            <p className="us-adm__pagecopy">View provisioning, room features, clock status, and device health.</p>
          </div>
        </header>
        <div className="us-device__skeleton" data-testid="device-skeleton" />
      </section>
    );
  }

  return (
    <div className="us-device" data-testid="screen" data-screen="S-36">
      <header className="us-adm__pagehead us-device__head">
        <div>
          <h1>Device &amp; Identity</h1>
          <p className="us-adm__pagecopy">View provisioning, room features, clock status, and device health.</p>
        </div>
        <span
          data-testid="provisioned-chip"
          className={`us-adm__chip ${notProvisioned ? 'us-adm__chip--not-configured' : 'us-adm__chip--configured'}`}
        >
          {notProvisioned ? 'Not provisioned' : 'Provisioned'}
        </span>
      </header>

      {notProvisioned ? (
        <div className="us-device__banner">
          <p>This device is not fully provisioned.</p>
          <p>Missing: {missingFields.join(', ')}.</p>
          <p>Recording start will be refused until the deploy-layer setup completes.</p>
        </div>
      ) : null}

      <div className="us-device__grid">
        <IdentityCard provisioning={provisioning} missing={missingFields} />
        <FeatureFlagsPanel provisioning={provisioning} />
        <TimeClockCard
          provisioning={provisioning}
          ntpSynced={health?.ntpSynced}
          clockOffsetMs={health?.clockOffsetMs}
        />
      </div>
      <div className={`us-device__live${wsStale ? ' us-device__live--dimmed' : ''}`} aria-live="off">
        <DeviceHealthCard health={health} isStale={isStale} />
        <AlertList />
      </div>
    </div>
  );
}
