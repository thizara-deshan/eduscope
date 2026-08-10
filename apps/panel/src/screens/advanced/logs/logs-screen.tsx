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

  return (
    <div className="us-logs" data-testid="screen" data-screen="S-34" aria-busy={loading}>
      <header className="us-adm__pagehead">
        <div>
          <h1>System Logs</h1>
          <p className="us-adm__pagecopy">Review live device events, narrow the results, or export the current view.</p>
        </div>
        <div className="us-logs__headactions">
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
      </header>
      {exportState === 'ready' ? <p className="us-adm__note" data-testid="export-ready">Export ready — download started.</p> : null}
      {exportState === 'failed' ? <p className="us-device__missing" data-testid="export-failed">{exportError}</p> : null}

      <section className="us-adm__section us-logs__results" aria-label="Log results">
      <LogFilters filter={filter} onChange={setFilter} />

      {loading ? (
        <div className="us-device__skeleton" data-testid="logs-skeleton" />
      ) : logs.length === 0 ? (
        <p className="us-adm__empty">
          {Object.keys(filter).length > 0 ? 'No logs match your filter — change your filter.' : 'No logs yet.'}
        </p>
      ) : (
        <>
          <LogTable logs={logs} onDrillIntoSession={(sessionId) => setFilter((f) => ({ ...f, sessionId }))} />
          {hasMore ? <button type="button" className="us-adm__secondary" onClick={loadMore}>Load more</button> : null}
        </>
      )}
      </section>
    </div>
  );
}
