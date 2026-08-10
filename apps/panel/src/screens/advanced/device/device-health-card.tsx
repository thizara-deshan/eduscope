import { Link } from 'react-router';
import type { DeviceHealth } from '@eduscope/shared';
import { PublisherStatesTable } from './publisher-states-table.js';

interface DeviceHealthCardProps {
  readonly health: DeviceHealth | undefined;
  readonly isStale: boolean;
}

const SMART_TONE: Record<string, string> = { good: 'on', warning: 'warning', failing: 'danger', unknown: 'faint' };

function formatBytes(bytes: number): string {
  const gb = bytes / 1_000_000_000;
  return gb >= 1000 ? `${(gb / 1000).toFixed(1)} TB` : `${gb.toFixed(0)} GB`;
}

/** S-36 §2.1/§2.3/§2.4 — capture card (Machine 5c, W6-D-1 budget cap) + SMART (C-7) + cpu/temp/boot + publishers; stale -> "checking…" everywhere (C-3). */
export function DeviceHealthCard({ health, isStale }: DeviceHealthCardProps): JSX.Element {
  if (!health || isStale) {
    return (
      <section className="us-adm__card us-device__card" aria-label="Health">
        <div className="us-device__healthhead">
          <h2 className="us-device__eyebrow">Health</h2>
          <span className="us-device__stale">
            {health ? `observed ${new Date(health.observedAt).toLocaleTimeString()} · last update was a while ago` : 'observed — · last update was a while ago'}
          </span>
        </div>
        <div className="us-device__field">
          <span className="us-device__label">Capture card</span>
          <span className="us-device__value us-device__value--faint">— checking…</span>
        </div>
        <div className="us-device__field">
          <span className="us-device__label">Disk (SMART)</span>
          <span className="us-device__value us-device__value--faint">— checking…</span>
        </div>
        <div className="us-device__field">
          <span className="us-device__label">Publishers</span>
          <span className="us-device__value us-device__value--faint">— checking…</span>
        </div>
      </section>
    );
  }

  const capture = health.captureCardState;
  const captureCopy: Record<typeof capture, string> = {
    present: 'Present',
    absent: 'Not detected',
    recovering: 'Recovering — power-cycling the input (up to 2 recovery attempts per hour)',
    failed: 'Failed — needs a person. Camera-only recording still works.',
  };
  const captureTone: Record<typeof capture, string> = {
    present: 'on', absent: 'warning', recovering: 'warning', failed: 'danger',
  };

  return (
    <section className="us-adm__card us-device__card" aria-label="Health">
      <div className="us-device__healthhead">
        <h2 className="us-device__eyebrow">Health</h2>
        <span className="us-device__note">observed {new Date(health.observedAt).toLocaleTimeString()} · refreshes every 60 s</span>
      </div>
      <div className="us-device__field">
        <span className="us-device__label">Capture card</span>
        <span className="us-device__value">
          <span className={`us-device__dot us-device__dot--${captureTone[capture]}`} aria-hidden="true" />
          {captureCopy[capture]}
        </span>
        {capture === 'recovering' || capture === 'failed' ? (
          <span className="us-device__note">Recovery budget: up to 2 recovery attempts per hour.</span>
        ) : null}
      </div>
      <div className="us-device__field">
        <span className="us-device__label">Disk (SMART)</span>
        <span className="us-device__value">
          <span className={`us-device__dot us-device__dot--${SMART_TONE[health.diskHealth]}`} aria-hidden="true" />
          {health.diskHealth}
        </span>
        <span className="us-device__value">
          {formatBytes(health.storageFreeBytes)} free of {formatBytes(health.storageTotalBytes)}
        </span>
        <Link to="/advanced/storage" className="us-device__manage-link">Manage → S-30</Link>
      </div>
      <div className="us-device__field">
        <span className="us-device__value">
          CPU load {health.cpuLoad1m ?? '—'} · Temp {health.tempC ?? '—'} °C · Last boot {new Date(health.lastBootAt).toLocaleString()}
        </span>
      </div>
      <PublisherStatesTable states={health.publisherStates} />
    </section>
  );
}
