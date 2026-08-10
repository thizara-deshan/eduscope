import type { Recording } from '@eduscope/shared';

export interface DeleteBody {
  readonly body: string;
  /** RET-2 stronger body: this recording is the only copy (§2.2, C-3). */
  readonly escalated: boolean;
  /** §2.3 in-flight line: an upload would be cancelled by this delete (C-5). */
  readonly inFlight: boolean;
  readonly metaTag: 'uploaded' | 'never uploaded';
}

const CALM_BODY = "This permanently removes the recording and its files from this device. This can't be undone.";
const ESCALATED_BODY = "This recording was never uploaded, so this device holds the only copy. Deleting it removes that copy permanently — the system would never delete an un-uploaded recording on its own.";

/** S-24 §2/C-1 — pure body/label selection, no dialog. */
export function deleteBody(rec: Pick<Recording, 'uploadState'>): DeleteBody {
  const escalated = rec.uploadState !== 'done';
  const inFlight = rec.uploadState === 'queued' || rec.uploadState === 'uploading' || rec.uploadState === 'completing';
  return {
    body: escalated ? ESCALATED_BODY : CALM_BODY,
    escalated,
    inFlight,
    metaTag: escalated ? 'never uploaded' : 'uploaded',
  };
}
