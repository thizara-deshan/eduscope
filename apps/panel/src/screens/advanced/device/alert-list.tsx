import { useState } from 'react';
import { AlertRow } from './alert-row.js';
import { useAlerts } from './use-alerts.js';
import { useIsStale } from '../../../store/selectors.js';

/** S-36 §2.1 — active alerts list; Show cleared toggle; "No active alerts." calm empty (C-4). */
export function AlertList(): JSX.Element {
  const [includeCleared, setIncludeCleared] = useState(false);
  const { alerts, loading, acknowledge, ackPending, ackError } = useAlerts({ includeCleared });
  const stale = useIsStale();

  return (
    <section className="us-adm__card us-device__card" aria-label="Active alerts">
      <div className="us-device__healthhead">
        <h2 className="us-device__eyebrow">Active alerts</h2>
        <label className="us-device__showcleared">
          <input
            type="checkbox"
            checked={includeCleared}
            onChange={(e) => setIncludeCleared(e.target.checked)}
            aria-label="Show cleared"
          />
          Show cleared
        </label>
      </div>
      {loading ? (
        <p className="us-adm__note">Loading…</p>
      ) : alerts.length === 0 ? (
        <p className="us-adm__note">No active alerts.</p>
      ) : (
        <div role="list" className="us-device__alertlist">
          {alerts.map((a) => (
            <AlertRow
              key={a.id}
              alert={a}
              onAck={acknowledge}
              pending={ackPending === a.id}
              disabled={stale}
              error={ackError?.id === a.id ? ackError.message : null}
            />
          ))}
        </div>
      )}
    </section>
  );
}
