import type { RetentionPolicy } from '@eduscope/shared';

/** S-30 — the SAME policy text the dashboard banner uses, generated from real numbers (INV-RP-1). */
export function RetentionPolicyCard({ policy }: { readonly policy: RetentionPolicy }): JSX.Element {
  return (
    <section className="us-adm__card us-storage__card" aria-label="Retention policy">
      <h2 className="us-device__eyebrow">Retention policy</h2>
      <p className="us-adm__note">
        Delete uploaded oldest first past {policy.maxAgeDays} days; never delete un-uploaded recordings.
      </p>
      <p className="us-adm__note">
        Warning at {policy.warningThresholdPct}% used · critical at {policy.criticalThresholdPct}% used
        {policy.refuseStartWhenCritical ? ' — new recordings are refused at critical' : ''}.
      </p>
    </section>
  );
}
