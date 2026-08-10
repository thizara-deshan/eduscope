import type { UploadJob } from '@eduscope/shared';
import { recordingBadge, type RecordingBadge } from '../../library/use-recording-badge.js';

export interface UploadRowLabel {
  readonly badge: RecordingBadge;
  readonly offline: boolean;
  readonly offlineCopy?: string | undefined;
}

/** §4.4 — the upload pipeline's dead-letter cap. Never hardcode this again elsewhere. */
const ATTEMPT_CAP = 8;
/** Never read by uploadRowLabel — a job row has no retention concept (only S-21 rows do). */
const NO_RETENTION = '9999-12-31T00:00:00.000Z';

/**
 * S-35 §3/CG-20 — composes `recordingBadge` (Task 5), never forks it. Adds
 * ONLY the offline/server split: `offline` is derived from `failureClass`
 * alone (never `lastError` text, C-5) — a connectivity failure spends no
 * attempt and must never read "attempt N of 8".
 */
export function uploadRowLabel(job: UploadJob): UploadRowLabel {
  const offline = job.state === 'failed' && job.failureClass === 'connectivity';

  let badge = recordingBadge(
    { state: 'ready', mergeState: 'done', uploadState: job.state, retentionDeleteAfter: NO_RETENTION },
    { progressPct: job.progressPct, nextAttemptAt: job.nextAttemptAt },
  );

  if (job.state === 'failed' && job.failureClass === 'server') {
    badge = {
      ...badge,
      label: `Upload failed · attempt ${job.attempt} of ${ATTEMPT_CAP} · next try ${job.nextAttemptAt ?? '—'}`,
    };
  }

  const offlineCopy = offline
    ? `Last tried ${job.lastErrorAt ?? '—'}. No attempts used — the device just can't reach the upload server right now.`
    : undefined;

  return { badge, offline, offlineCopy };
}
