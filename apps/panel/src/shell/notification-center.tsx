import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SystemAlert } from '@eduscope/shared';
import { useClient } from '../client/client-provider.js';
import { useWsShallow } from '../store/selectors.js';
import { useAlertSuppression } from './alert-suppression.js';
import './shell.css';

const SEVERITY_ORDER: readonly SystemAlert['severity'][] = ['critical', 'error', 'warning', 'info'];

export function NotificationCenter(): JSX.Element {
  const client = useClient();
  const query = useQuery({ queryKey: ['alerts'], queryFn: () => client.listAlerts() });
  const storeAlerts = useWsShallow((state) => state.alerts);
  const suppressed = useAlertSuppression((state) => state.codes);
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const merged = new Map<string, SystemAlert>();
  for (const alert of query.data?.items ?? []) merged.set(alert.id, alert);
  for (const alert of Object.values(storeAlerts)) merged.set(alert.id, alert);

  const active = Array.from(merged.values())
    .filter((alert) => !alert.clearedAt && !dismissed.has(alert.id) && !suppressed.includes(alert.code))
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));

  useEffect(() => {
    if (!open) return undefined;

    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="us-notifications">
      <button
        ref={triggerRef}
        type="button"
        className="us-notifications__trigger"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Notifications, ${active.length} active`}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">🔔</span>
        {active.length > 0 ? <span className="us-notifications__count">{active.length}</span> : null}
      </button>

      {open ? (
        <section role="dialog" aria-label="Notifications" className="us-notifications__panel">
          <header className="us-notifications__head">
            <div>
              <h2>Notifications</h2>
              <p>{active.length} active</p>
            </div>
            <button
              type="button"
              aria-label="Close notifications"
              onClick={() => {
                setOpen(false);
                triggerRef.current?.focus();
              }}
            >
              ✕
            </button>
          </header>
          <div className="us-notifications__list">
            {active.length === 0 ? (
              <p className="us-notifications__empty">You’re all caught up.</p>
            ) : active.map((alert) => (
              <article
                key={alert.id}
                className={`us-notifications__card us-notifications__card--${alert.severity}`}
                data-testid="notification-card"
                data-alert-id={alert.id}
              >
                <div className="us-notifications__cardhead">
                  <span className="us-notifications__severity">{alert.severity}</span>
                  <strong>{alert.title}</strong>
                </div>
                {alert.detail ? <p>{alert.detail}</p> : null}
                <button
                  type="button"
                  aria-label={`Acknowledge ${alert.title}`}
                  onClick={() => {
                    void client.acknowledgeAlert(alert.id);
                    setDismissed((current) => new Set(current).add(alert.id));
                  }}
                >
                  Acknowledge
                </button>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
