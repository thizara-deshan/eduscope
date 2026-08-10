import { useState } from 'react';
import { LogFilters } from './log-filters.js';
import { LogTable } from './log-table.js';
import { useLogExport } from './log-export.js';
import { useLogs, type LogFilter } from './use-logs.js';
import './logs.css';

/** S-34 — filters, live tail, CSV export using the same filter set. */
export function LogsScreen(): JSX.Element {
  const [filter, setFilter] = useState<LogFilter>({});
  const { loading, logs, hasMore, loadMore, tailStale } = useLogs(filter);
  const { state: exportState, error: exportError, exportCsv } = useLogExport();

  if (loading) {
    return (
      <section className="us-adm__card" data-testid="screen" data-screen="S-34" aria-busy="true">
        <h1>System Logs</h1>
        <div className="us-device__skeleton" data-testid="logs-skeleton" />
      </section>
    );
  }

  return (
    <div className="us-logs" data-testid="screen" data-screen="S-34">
      <div className="us-users__head">
        <h1>System Logs</h1>
        <div>
          {tailStale ? <span className="us-device__missing" data-testid="tail-stale">live tail not updating</span> : null}
          <button
            type="button"
            className="us-adm__secondary"
            disabled={exportState === 'exporting'}
            onClick={() => exportCsv(filter)}
          >
            {exportState === 'exporting' ? 'Exporting…' : 'Export CSV'}
          </button>
        </div>
      </div>
      {exportState === 'ready' ? <p className="us-adm__note" data-testid="export-ready">Export ready — download started.</p> : null}
      {exportState === 'failed' ? <p className="us-device__missing" data-testid="export-failed">{exportError}</p> : null}

      <LogFilters filter={filter} onChange={setFilter} />

      {logs.length === 0 ? (
        <p className="us-adm__note">
          {Object.keys(filter).length > 0 ? 'No logs match your filter — change your filter.' : 'No logs yet.'}
        </p>
      ) : (
        <>
          <LogTable logs={logs} onDrillIntoSession={(sessionId) => setFilter((f) => ({ ...f, sessionId }))} />
          {hasMore ? <button type="button" className="us-adm__secondary" onClick={loadMore}>Load more</button> : null}
        </>
      )}
    </div>
  );
}
