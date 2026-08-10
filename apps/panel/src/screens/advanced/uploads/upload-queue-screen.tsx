import { useState } from 'react';
import type { UploadJobState } from '@eduscope/shared';
import { UploadJobRow } from './upload-job-row.js';
import { useUploadJobs } from './use-upload-jobs.js';
import './uploads.css';

const STATE_OPTIONS: readonly { readonly label: string; readonly value: UploadJobState | undefined }[] = [
  { label: 'All', value: undefined },
  { label: 'Queued', value: 'queued' },
  { label: 'Uploading', value: 'uploading' },
  { label: 'Failed', value: 'failed' },
  { label: 'Dead-letter', value: 'dead-letter' },
  { label: 'Done', value: 'done' },
];

/** S-35 — inside `.us-adm__content` (S-25 shell). Title + State filter + list + Load more + the empty good state. */
export function UploadQueueScreen(): JSX.Element {
  const [state, setState] = useState<UploadJobState | undefined>(undefined);
  const { loading, jobs, hasMore, loadMore } = useUploadJobs({ state });

  return (
    <section className="us-adm__card us-uploads" data-testid="screen" data-screen="S-35">
      <h1>Upload Queue</h1>
      <div className="us-uploads__filter">
        {STATE_OPTIONS.map((opt) => (
          <button
            key={opt.label}
            type="button"
            className={`us-uploads__chip${state === opt.value ? ' us-uploads__chip--active' : ''}`}
            onClick={() => setState(opt.value)}
          >
            State: {opt.label}
          </button>
        ))}
      </div>

      {loading ? (
        <ul className="us-uploads__list" aria-busy="true">
          {[0, 1, 2].map((i) => <li key={i} className="us-uploadrow us-uploadrow--skeleton" data-testid="upload-row-skeleton" />)}
        </ul>
      ) : jobs.length === 0 ? (
        <p className="us-uploads__empty">Everything has been uploaded.</p>
      ) : (
        <ul className="us-uploads__list">
          {jobs.map((job) => <UploadJobRow key={job.id} job={job} />)}
        </ul>
      )}

      {hasMore ? (
        <button type="button" className="us-uploads__load-more" onClick={loadMore}>Load more</button>
      ) : null}
    </section>
  );
}
