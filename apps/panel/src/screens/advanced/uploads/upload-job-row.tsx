import { useState } from 'react';
import type { UploadJob } from '@eduscope/shared';
import { uploadRowLabel } from './use-upload-row-label.js';
import { UploadParts } from './upload-parts.js';
import { RequeueButton } from './requeue-button.js';
import './uploads.css';

/** S-35 §5.1 — 64 px row; no cancel anywhere (C-1); requeue only on dead-letter. */
export function UploadJobRow({ job }: { readonly job: UploadJob }): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const { badge, offline, offlineCopy } = uploadRowLabel(job);

  return (
    <li className="us-uploadrow">
      <div className="us-uploadrow__main">
        <span className={`us-uploadrow__badge us-badge--${badge.tone}`}>
          <span aria-hidden="true">{badge.glyph}</span>
          {offline ? 'Waiting for the network · will keep trying' : badge.label}
        </span>
        <span className="us-uploadrow__title">{job.recordingTitle}</span>
        {offline && offlineCopy ? <span className="us-uploadrow__offline-copy">{offlineCopy}</span> : null}
        {job.state === 'dead-letter' && job.lastError ? (
          <span className="us-uploadrow__reason">{job.lastError}</span>
        ) : null}
      </div>
      {job.state === 'dead-letter' ? <RequeueButton job={job} /> : null}
      <button
        type="button"
        className="us-uploadrow__expand"
        aria-expanded={expanded}
        aria-label={`${expanded ? 'Collapse' : 'Expand'} parts for ${job.recordingTitle}`}
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? '▲' : '▼'}
      </button>
      {expanded ? <UploadParts jobId={job.id} /> : null}
    </li>
  );
}
