import { useState } from 'react'
import { Download } from 'lucide-react'
import { SYSTEM_LOGS, type LogLevel } from '../../../mock/admin'
import { cn } from '../../ui/cn'

export function SystemLogs() {
  const [level, setLevel] = useState<'All' | LogLevel>('All')
  const [query, setQuery] = useState('')

  const rows = SYSTEM_LOGS.filter(
    (l) =>
      (level === 'All' || l.level === level) &&
      (query === '' || l.message.toLowerCase().includes(query.toLowerCase())),
  )

  return (
    <section className="us-adm__card">
      <div className="us-adm__logshead">
        <h2 className="us-adm__cardtitle">System Logs &amp; Audit Trail</h2>
        <div className="us-adm__logstools">
          <select
            className="us-select"
            value={level}
            onChange={(e) => setLevel(e.target.value as 'All' | LogLevel)}
            aria-label="Filter by level"
          >
            <option value="All">All Levels</option>
            <option value="INFO">Info</option>
            <option value="WARN">Warn</option>
            <option value="ERROR">Error</option>
          </select>
          <input
            className="us-input"
            placeholder="Search logs…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="us-adm__secondary">
            <Download size={15} />
            Export CSV
          </button>
        </div>
      </div>

      <div className="us-adm__table">
        <div className="us-adm__trow us-adm__trow--head us-adm__trow--logs">
          <span>Timestamp</span>
          <span>Level</span>
          <span>Category</span>
          <span>Message</span>
        </div>
        {rows.map((l, i) => (
          <div key={i} className="us-adm__trow us-adm__trow--logs">
            <span className="us-adm__mono">{l.timestamp}</span>
            <span>
              <span className={cn('us-adm__level', `us-adm__level--${l.level.toLowerCase()}`)}>
                {l.level}
              </span>
            </span>
            <span>
              <span className="us-adm__chip">{l.category}</span>
            </span>
            <span>{l.message}</span>
          </div>
        ))}
        {rows.length === 0 && <p className="us-adm__note">No log entries match your filters.</p>}
      </div>
    </section>
  )
}
