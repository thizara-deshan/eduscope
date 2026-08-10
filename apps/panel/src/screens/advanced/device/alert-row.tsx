import type { SystemAlert } from '@eduscope/shared';

interface AlertRowProps {
  readonly alert: SystemAlert;
  readonly onAck: (id: string) => void;
  readonly pending: boolean;
  readonly disabled: boolean;
  readonly error: string | null;
}

const SEVERITY_GLYPH: Record<SystemAlert['severity'], string> = {
  critical: '⛔', error: '⛔', warning: '⚠', info: 'ℹ',
};

/** S-36 §2.1/C-4 — one SystemAlert; Acknowledge never implies "fixed" — still-active stays labelled, never removed. */
export function AlertRow({ alert, onAck, pending, disabled, error }: AlertRowProps): JSX.Element {
  const acknowledged = alert.acknowledgedBy !== null;

  return (
    <article className="us-device__alertrow" aria-label={`${alert.severity} ${alert.title}`}>
      <div className="us-device__alerthead">
        <span className={`us-device__alertsev us-device__alertsev--${alert.severity}`}>
          <span aria-hidden="true">{SEVERITY_GLYPH[alert.severity]}</span>
          {alert.severity} · {alert.category}
        </span>
        <span className="us-device__value">{alert.title}</span>
        {acknowledged && alert.clearedAt === null ? (
          <span className="us-device__acked">✓ acknowledged · still active</span>
        ) : !disabled ? (
          <button
            type="button"
            className="us-adm__secondary"
            onClick={() => onAck(alert.id)}
            disabled={pending || disabled}
            aria-label={`Acknowledge — record that this alert has been seen; it stays active until the condition clears`}
          >
            {pending ? 'Acknowledging…' : 'Acknowledge'}
          </button>
        ) : (
          <button type="button" className="us-adm__secondary" disabled aria-label="Acknowledge">Acknowledge</button>
        )}
      </div>
      {alert.detail ? <p className="us-adm__note">{alert.detail}</p> : null}
      <p className="us-adm__note">raised {new Date(alert.raisedAt).toLocaleTimeString()}</p>
      {error ? <p className="us-device__missing">{error}</p> : null}
    </article>
  );
}
