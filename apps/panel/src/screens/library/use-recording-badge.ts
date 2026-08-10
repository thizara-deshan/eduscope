import type { Recording } from '@eduscope/shared';

/**
 * S-21 §3 / LIB-D-1 — the ONE badge derivation, shared verbatim with S-35
 * (`uploadRowLabel` composes this, never forks it). Pure: no JSX, no store,
 * no client. Precedence: merge state outranks upload state (a recording still
 * `merging` has no meaningful upload state yet, SM-D-1); the RET-2 "kept"
 * marker (#9) composes as a SECOND line onto whatever badge already applies
 * (§3.1 precedence note) rather than replacing it.
 */
export type BadgeTone = 'success' | 'accent' | 'warning' | 'danger' | 'muted' | 'record';

export interface RecordingBadge {
  readonly label: string;
  readonly tone: BadgeTone;
  readonly glyph: string; // decorative reinforcement only (● ◐ ▲ ⚠)
  readonly secondary?: string; // the RET-2 "kept" second line (#9)
}

export interface RecordingBadgeLive {
  readonly progressPct?: number | undefined;
  readonly nextAttemptAt?: string | null | undefined;
}

/** The only fields the derivation reads — lets S-35's upload-job rows (which have no full Recording) reuse it verbatim. */
export type RecordingBadgeInput = Pick<Recording, 'state' | 'mergeState' | 'uploadState' | 'retentionDeleteAfter'>;

const RETENTION_KEPT_SECONDARY = "Kept — never uploaded (won't auto-delete)";

export function recordingBadge(
  rec: RecordingBadgeInput,
  live?: RecordingBadgeLive,
  now?: number,
): RecordingBadge {
  const base = baseBadge(rec, live);
  const nowMs = now ?? Date.now();
  const kept = Date.parse(rec.retentionDeleteAfter) < nowMs && rec.uploadState !== 'done';
  return kept ? { ...base, secondary: RETENTION_KEPT_SECONDARY } : base;
}

function baseBadge(rec: RecordingBadgeInput, live?: RecordingBadgeLive): RecordingBadge {
  // #8 — still capturing: no job exists yet, the row is live.
  if (rec.state === 'capturing') {
    return { label: 'Recording', tone: 'record', glyph: '●' };
  }
  // #1 — merge in flight outranks any upload state (SM-D-1).
  if (rec.mergeState === 'pending' || rec.mergeState === 'running') {
    return { label: 'Preparing…', tone: 'muted', glyph: '◐' };
  }
  // #2 — merge failed: no upload job exists (INV-UJ-3).
  if (rec.mergeState === 'failed') {
    return { label: "Couldn't prepare this recording", tone: 'warning', glyph: '⚠' };
  }
  // #3 — waiting to upload.
  if (rec.uploadState === 'queued') {
    return { label: 'Waiting to upload', tone: 'muted', glyph: '◐' };
  }
  // #4 — uploading/completing (completing renders as uploading, no separate label).
  if (rec.uploadState === 'uploading' || rec.uploadState === 'completing') {
    return { label: `Uploading… ${live?.progressPct ?? 0}%`, tone: 'accent', glyph: '▲' };
  }
  // #5 — uploaded.
  if (rec.uploadState === 'done') {
    return { label: 'Uploaded', tone: 'success', glyph: '●' };
  }
  // #6 — upload failed, quotes the real nextAttemptAt (never a guessed backoff).
  if (rec.uploadState === 'failed') {
    const nextAttemptAt = live?.nextAttemptAt ?? null;
    return {
      label: `Upload failed — retrying (next try ${nextAttemptAt ?? '—'})`,
      tone: 'warning',
      glyph: '▲',
    };
  }
  // #7 — dead-letter: needs attention.
  if (rec.uploadState === 'dead-letter') {
    return { label: 'Upload needs attention', tone: 'danger', glyph: '⚠' };
  }
  // No job yet and not capturing/merging — treat as waiting to upload.
  return { label: 'Waiting to upload', tone: 'muted', glyph: '◐' };
}
