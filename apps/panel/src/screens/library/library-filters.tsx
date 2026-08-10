import { useOskField } from '../../keyboard/use-keyboard.js';
import type { LibraryFilters as LibraryFiltersValue } from './use-recordings.js';
import './library.css';

/**
 * S-21 §2.3 — chips, not a menu: each edit maps to a real `listRecordings`
 * server parameter and the caller resets the cursor (C-7). No client-side
 * filtering happens here or anywhere downstream (C-1).
 */
export function LibraryFilters({
  value,
  isAdmin,
  onChange,
}: {
  readonly value: LibraryFiltersValue;
  readonly isAdmin: boolean;
  readonly onChange: (next: LibraryFiltersValue) => void;
}): JSX.Element {
  const search = useOskField({
    value: value.q ?? '',
    onChange: (q) => onChange({ ...value, q: q || undefined }),
    layout: 'default',
  });
  const ownerSearch = useOskField({
    value: value.ownerUserId ?? '',
    onChange: (ownerUserId) => onChange({ ...value, ownerUserId: ownerUserId || undefined }),
    layout: 'default',
  });

  return (
    <div className="us-libfilters">
      <div className="us-libfilters__chip">
        <input
          type="text"
          className="us-input"
          placeholder="Search recordings"
          aria-label="Search recordings"
          value={value.q ?? ''}
          onChange={(e) => onChange({ ...value, q: e.target.value || undefined })}
          onFocus={search.onFocus}
          onBlur={search.onBlur}
          data-osk={search['data-osk']}
        />
        {value.q ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => onChange({ ...value, q: undefined })}
          >
            ✕
          </button>
        ) : null}
      </div>
      {isAdmin ? (
        <div className="us-libfilters__chip">
          <input
            type="text"
            className="us-input"
            placeholder="Owner: All"
            aria-label="Filter by owner"
            value={value.ownerUserId ?? ''}
            onChange={(e) => onChange({ ...value, ownerUserId: e.target.value || undefined })}
            {...ownerSearch}
          />
          {value.ownerUserId ? (
            <button
              type="button"
              aria-label="Clear owner filter"
              onClick={() => onChange({ ...value, ownerUserId: undefined })}
            >
              ✕
            </button>
          ) : null}
        </div>
      ) : null}
      {isAdmin ? (
        <label className="us-libfilters__chip us-libfilters__chip--toggle">
          <input
            type="checkbox"
            checked={value.includeDeleted ?? false}
            onChange={(e) => onChange({ ...value, includeDeleted: e.target.checked || undefined })}
            aria-label="Show deleted"
          />
          Show deleted
        </label>
      ) : null}
    </div>
  );
}
