import type { DeviceProvisioning } from '@eduscope/shared';

interface TimeClockCardProps {
  readonly provisioning: DeviceProvisioning;
  readonly ntpSynced: boolean | undefined;
  readonly clockOffsetMs: number | null | undefined;
}

/** S-36 §2.1/§2.5 — timezone/ntpServers static; ntpSynced/clockOffsetMs live (from device.health), unsynced -> warning + pointer to the System alert (C-5). */
export function TimeClockCard({ provisioning, ntpSynced, clockOffsetMs }: TimeClockCardProps): JSX.Element {
  const unsynced = ntpSynced === false;

  return (
    <section className="us-adm__card us-device__card" aria-label="Time & clock">
      <h2 className="us-device__eyebrow">Time & clock</h2>
      <div className={`us-device__feature${unsynced ? ' us-device__feature--warning' : ''}`}>
        <span className={`us-device__dot us-device__dot--${unsynced ? 'warning' : 'on'}`} aria-hidden="true" />
        <span className="us-device__label">{unsynced ? 'Clock not synced' : 'Clock synced'}</span>
        <span className="us-device__value">offset {clockOffsetMs ?? 0} ms</span>
        <span className="us-device__label">Timezone</span>
        <span className="us-device__value">{provisioning.timezone}</span>
      </div>
      {unsynced ? (
        <p className="us-adm__note">
          Correct time is load-bearing for titles, retention and logs — see the System alert below.
        </p>
      ) : null}
      <div className="us-device__field">
        <span className="us-device__label">NTP servers</span>
        <span className="us-device__value">{provisioning.ntpServers.join(', ')}</span>
      </div>
    </section>
  );
}
