import { useQuery } from '@tanstack/react-query';
import type { RetentionPolicy } from '@eduscope/shared';
import { useClient } from '../../client/client-provider.js';
import { useWsShallow } from '../../store/selectors.js';

function formatBytes(bytes: number): string {
  const units = bytes >= 1_000_000_000_000
    ? { divisor: 1_000_000_000_000, suffix: 'TB' }
    : { divisor: 1_000_000_000, suffix: 'GB' };
  const value = bytes / units.divisor;
  const digits = value >= 10 ? Math.round(value).toString() : value.toFixed(1).replace(/\.0$/, '');
  return `${digits} ${units.suffix}`;
}

export function retentionPolicySentence(policy: RetentionPolicy): string {
  const dayWord = policy.maxAgeDays === 1 ? 'day' : 'days';
  if (policy.neverDeleteUnuploaded && policy.earlyDeleteOrder === 'uploaded-oldest-first') {
    return `Recordings are deleted ${policy.maxAgeDays} ${dayWord} after they upload.`;
  }
  return `Recordings may be deleted ${policy.maxAgeDays} ${dayWord} after capture.`;
}

export function CaptureDiskRow({ dense }: { readonly dense: boolean }): JSX.Element {
  const client = useClient();
  const liveStorage = useWsShallow((state) => state.storage);
  const query = useQuery({
    queryKey: ['storage-overview'],
    queryFn: () => client.getStorageOverview(),
  });
  const storage = liveStorage ?? query.data;

  if (!storage) {
    return (
      <section className="us-captureblock" data-testid="capture-disk" aria-labelledby="capture-disk-label">
        <h2 className="us-captureblock__label" id="capture-disk-label">DISK</h2>
        <div className="us-capturedisk__skeleton" data-testid="capture-disk-skeleton" />
      </section>
    );
  }

  const usedPct = storage.totalBytes > 0
    ? Math.round(((storage.totalBytes - storage.freeBytes) / storage.totalBytes) * 100)
    : 0;
  const figure = `${formatBytes(storage.freeBytes)} free of ${formatBytes(storage.totalBytes)}`;
  const policy = retentionPolicySentence(storage.policy);

  return (
    <section
      className={`us-captureblock us-capturedisk us-capturedisk--${storage.pressure}`}
      data-testid="capture-disk"
      data-density={dense ? 'dense' : 'comfortable'}
      aria-labelledby="capture-disk-label"
    >
      <h2 className="us-captureblock__label" id="capture-disk-label">DISK</h2>
      <div className="us-capturedisk__content">
        {!dense ? (
          <span
            className="us-capturedisk__bar"
            role="progressbar"
            aria-label="Disk space used"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={usedPct}
          >
            <span className="us-capturedisk__fill" style={{ width: `${usedPct}%` }} />
          </span>
        ) : null}
        <span className="us-capturedisk__figure">{figure}</span>
        <span className="us-capturedisk__policy">{policy}</span>
      </div>
    </section>
  );
}
