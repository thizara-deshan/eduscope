import { CapacityStats } from './capacity-stats.js';
import { RetentionPolicyCard } from './retention-policy-card.js';
import { VolumeList } from './volume-list.js';
import { RegisterDriveForm } from './register-drive-form.js';
import { useStorage } from './use-storage.js';
import { useIsStale } from '../../../store/selectors.js';
import './storage.css';

/** S-30 — stats + SMART + retention-in-real-numbers; register + format as one guarded danger-zone op. */
export function StorageScreen(): JSX.Element {
  const {
    overview, loading, registerVolume, registering, registerError,
    formatVolume, formattingId, formatError, clearFormatError,
  } = useStorage();
  const stale = useIsStale();

  if (loading || !overview) {
    return (
      <section className="us-storage" data-testid="screen" data-screen="S-30" aria-busy="true">
        <header className="us-adm__pagehead">
          <div>
            <h1>Local Storage</h1>
            <p className="us-adm__pagecopy">Monitor capacity, retention, and the drives used for recordings.</p>
          </div>
        </header>
        <div className="us-device__skeleton" data-testid="storage-skeleton" />
      </section>
    );
  }

  return (
    <div className="us-storage" data-testid="screen" data-screen="S-30">
      <header className="us-adm__pagehead">
        <div>
          <h1>Local Storage</h1>
          <p className="us-adm__pagecopy">Monitor capacity, retention, and the drives used for recordings.</p>
        </div>
      </header>
      <div className="us-storage__overview">
      <section className="us-adm__card us-adm__section us-storage__card" aria-label="Capacity">
        <h2 className="us-device__eyebrow">Capacity</h2>
        <CapacityStats totalBytes={overview.totalBytes} freeBytes={overview.freeBytes} pressure={overview.pressure} />
        {overview.pressure === 'critical' ? (
          <p className="us-device__missing">Storage is critical — items past retention that were never uploaded cannot be reclaimed; recording start is refused until space is freed.</p>
        ) : null}
      </section>
      <RetentionPolicyCard policy={overview.policy} />
      </div>
      <VolumeList
        volumes={overview.volumes}
        formatVolume={formatVolume}
        formattingId={formattingId}
        formatError={formatError}
        clearFormatError={clearFormatError}
        disabled={stale}
      />
      <RegisterDriveForm
        onRegister={(uuid, label) => registerVolume(label ? { uuid, label } : { uuid })}
        registering={registering}
        error={registerError}
        disabled={stale}
      />
    </div>
  );
}
