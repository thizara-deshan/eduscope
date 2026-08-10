import type { SmartStatus } from '@eduscope/shared';

const TONE: Record<SmartStatus, string> = { good: 'on', warning: 'warning', failing: 'danger', unknown: 'faint' };

/** S-30 — SMART in words; `unknown` is legitimate, never hardcoded Good (INV-DH-2, C-7). */
export function DiskHealthRow({ smartStatus }: { readonly smartStatus: SmartStatus }): JSX.Element {
  return (
    <div className="us-device__field" aria-label="Disk health">
      <span className="us-device__label">SMART</span>
      <span className="us-device__value">
        <span className={`us-device__dot us-device__dot--${TONE[smartStatus]}`} aria-hidden="true" />
        {smartStatus}
      </span>
    </div>
  );
}
