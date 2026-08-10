import type { LogCategory, LogLevel } from '@eduscope/shared';
import type { LogFilter } from './use-logs.js';

interface LogFiltersProps {
  readonly filter: LogFilter;
  readonly onChange: (filter: LogFilter) => void;
}

const LEVELS: readonly LogLevel[] = ['INFO', 'WARN', 'ERROR'];
const CATEGORIES: readonly LogCategory[] = ['Auth', 'System', 'Hardware', 'Session'];

/** `exactOptionalPropertyTypes` forbids `{ key: undefined }` — clearing a filter field deletes the key. */
function without(filter: LogFilter, key: keyof LogFilter): LogFilter {
  const next = { ...filter };
  delete next[key];
  return next;
}

/** S-34 — level/category chips, search, time range, sessionId drill-in. */
export function LogFilters({ filter, onChange }: LogFiltersProps): JSX.Element {
  return (
    <div className="us-logs__filters">
      <input
        type="text"
        value={filter.q ?? ''}
        onChange={(e) => onChange(e.target.value ? { ...filter, q: e.target.value } : without(filter, 'q'))}
        placeholder="Search message"
        aria-label="Search logs"
      />
      <div className="us-logs__chips">
        <button
          type="button"
          className={`us-users__chip${filter.level === undefined ? ' us-users__chip--active' : ''}`}
          onClick={() => onChange(without(filter, 'level'))}
        >
          All levels
        </button>
        {LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            className={`us-users__chip${filter.level === level ? ' us-users__chip--active' : ''}`}
            onClick={() => onChange({ ...filter, level })}
          >
            {level}
          </button>
        ))}
      </div>
      <div className="us-logs__chips">
        <button
          type="button"
          className={`us-users__chip${filter.category === undefined ? ' us-users__chip--active' : ''}`}
          onClick={() => onChange(without(filter, 'category'))}
        >
          All categories
        </button>
        {CATEGORIES.map((category) => (
          <button
            key={category}
            type="button"
            className={`us-users__chip${filter.category === category ? ' us-users__chip--active' : ''}`}
            onClick={() => onChange({ ...filter, category })}
          >
            {category}
          </button>
        ))}
      </div>
      {filter.sessionId ? (
        <span className="us-adm__note">
          Session {filter.sessionId}
          <button type="button" className="us-adm__secondary" onClick={() => onChange(without(filter, 'sessionId'))}>
            Clear session filter
          </button>
        </span>
      ) : null}
    </div>
  );
}
