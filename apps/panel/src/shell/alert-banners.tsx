import { useQuery } from '@tanstack/react-query';
import type { SystemAlert } from '@eduscope/shared';
import { useClient } from '../client/client-provider.js';
import { useWsShallow } from '../store/selectors.js';
import './shell.css';

const SEVERITY_ORDER: readonly SystemAlert['severity'][] = ['critical', 'error', 'warning', 'info'];

const TREATMENT: Record<SystemAlert['severity'], 'info' | 'warning' | 'error'> = {
  info: 'info',
  warning: 'warning',
  error: 'error',
  critical: 'error',
};

/**
 * The shell's banner host (screen-inventory §2 S-03). Copy is DATA, not
 * code: `title`/`detail` render exactly as the server sends them — the
 * contract documents `title` as "plain language for a non-technical
 * lecturer", and this is the only way `storage.warning` can satisfy
 * INV-RP-1 (text generated from `RetentionPolicy`, never hardcoded).
 *
 * A fixed 56px lane regardless of count (screen-inventory §2 S-03 touch
 * notes): more than one active alert stacks by severity with a count
 * affordance, never by growing the lane.
 */
export function AlertBanners(): JSX.Element {
  const client = useClient();
  const query = useQuery({ queryKey: ['alerts'], queryFn: () => client.listAlerts() });
  const storeAlerts = useWsShallow((s) => s.alerts);

  const merged = new Map<string, SystemAlert>();
  for (const alert of query.data?.items ?? []) merged.set(alert.id, alert);
  for (const alert of Object.values(storeAlerts)) merged.set(alert.id, alert);

  const active = Array.from(merged.values())
    .filter((a) => !a.clearedAt)
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));

  if (active.length === 0) return <div className="us-alertlane" data-testid="alert-lane" />;

  const top = active[0]!;
  const treatment = TREATMENT[top.severity];

  return (
    <div className="us-alertlane" data-testid="alert-lane">
      <div
        className={`us-alertbanner us-alertbanner--${treatment}`}
        data-testid="alert-banner"
        data-alert-id={top.id}
      >
        <div className="us-alertbanner__text">
          <strong>{top.title}</strong>
          {top.detail && <span className="us-alertbanner__detail">{top.detail}</span>}
        </div>
        {active.length > 1 && (
          <span className="us-alertbanner__count" data-testid="alert-count">
            +{active.length - 1}
          </span>
        )}
        <button
          type="button"
          className="us-alertbanner__ack"
          aria-label={`Acknowledge ${top.title}`}
          onClick={() => void client.acknowledgeAlert(top.id)}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
