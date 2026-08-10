import { useState } from 'react';
import type { LogEntry } from '@eduscope/shared';

interface LogTableProps {
  readonly logs: readonly LogEntry[];
  readonly onDrillIntoSession: (sessionId: string) => void;
}

/** S-34 — rows >= 44px, tap-to-expand message, sessionId drill-in. */
export function LogTable({ logs, onDrillIntoSession }: LogTableProps): JSX.Element {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <ul className="us-logs__table" role="list">
      {logs.map((entry) => (
        <li key={entry.id} className="us-logs__row" data-testid={`log-row-${entry.id}`}>
          <button
            type="button"
            className="us-logs__rowmain"
            onClick={() => setExpandedId((id) => (id === entry.id ? null : entry.id))}
            aria-expanded={expandedId === entry.id}
          >
            <span className={`us-logs__level us-logs__level--${entry.level.toLowerCase()}`}>{entry.level}</span>
            <span className="us-adm__note">{entry.category}</span>
            <span className="us-device__value">{new Date(entry.at).toLocaleString()}</span>
            <span className="us-logs__message">{entry.message}</span>
          </button>
          {expandedId === entry.id ? (
            <div className="us-logs__detail">
              <p className="us-adm__note">service: {entry.service}</p>
              {entry.sessionId ? (
                <button type="button" className="us-adm__secondary" onClick={() => onDrillIntoSession(entry.sessionId!)}>
                  View session {entry.sessionId}
                </button>
              ) : null}
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
