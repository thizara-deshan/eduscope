import { describe, expect, it } from 'vitest';
import type { Recording } from '@eduscope/shared';
import { recordingBadge } from './use-recording-badge.js';

const NOW = Date.parse('2026-08-10T12:00:00.000Z');
const FUTURE = new Date(NOW + 30 * 24 * 60 * 60_000).toISOString();
const PAST = new Date(NOW - 30 * 24 * 60 * 60_000).toISOString();

function rec(overrides: Partial<Recording>): Recording {
  return {
    id: 'REC1', sessionId: 'SESS1', title: 'Lecture', hallDisplayName: 'Hall A',
    ownerUserId: 'U1', ownerDisplayName: 'A. Perera', startedAt: '2026-08-10T09:00:00.000Z',
    endedAt: '2026-08-10T09:50:00.000Z', state: 'ready', layoutPresetId: 'fifty-fifty',
    durationMs: 3_000_000, totalBytes: 1_000_000, segmentCount: 1,
    mergeState: 'done', uploadState: 'done', retentionDeleteAfter: FUTURE,
    deletedAt: null, deleteReason: null,
    ...overrides,
  };
}

describe('recordingBadge (S-21 §3.1 / LIB-D-1) — the one shared derivation', () => {
  it('#1 mergeState pending/running -> Preparing…', () => {
    expect(recordingBadge(rec({ mergeState: 'pending', uploadState: null }), {}, NOW)).toMatchObject(
      { label: 'Preparing…', tone: 'muted' },
    );
    expect(recordingBadge(rec({ mergeState: 'running', uploadState: null }), {}, NOW)).toMatchObject(
      { label: 'Preparing…', tone: 'muted' },
    );
  });

  it('#2 mergeState failed -> Couldn\'t prepare this recording', () => {
    expect(recordingBadge(rec({ mergeState: 'failed', uploadState: null }), {}, NOW)).toMatchObject(
      { label: "Couldn't prepare this recording", tone: 'warning' },
    );
  });

  it('#3 uploadState queued -> Waiting to upload', () => {
    expect(recordingBadge(rec({ mergeState: 'done', uploadState: 'queued' }), {}, NOW)).toMatchObject(
      { label: 'Waiting to upload', tone: 'muted' },
    );
  });

  it('#4 uploadState uploading/completing -> Uploading… {pct}%, quoting the live progressPct', () => {
    expect(recordingBadge(rec({ mergeState: 'done', uploadState: 'uploading' }), { progressPct: 62 }, NOW))
      .toMatchObject({ label: 'Uploading… 62%', tone: 'accent' });
    expect(recordingBadge(rec({ mergeState: 'done', uploadState: 'completing' }), { progressPct: 99 }, NOW))
      .toMatchObject({ label: 'Uploading… 99%', tone: 'accent' });
  });

  it('#5 uploadState done -> Uploaded', () => {
    expect(recordingBadge(rec({ mergeState: 'done', uploadState: 'done' }), {}, NOW)).toMatchObject(
      { label: 'Uploaded', tone: 'success' },
    );
  });

  it('#6 uploadState failed -> quotes the live nextAttemptAt from the field, never a guessed backoff', () => {
    expect(
      recordingBadge(rec({ mergeState: 'done', uploadState: 'failed' }), { nextAttemptAt: '14:20' }, NOW),
    ).toMatchObject({ label: 'Upload failed — retrying (next try 14:20)', tone: 'warning' });
  });

  it('#7 uploadState dead-letter -> Upload needs attention', () => {
    expect(recordingBadge(rec({ mergeState: 'done', uploadState: 'dead-letter' }), {}, NOW)).toMatchObject(
      { label: 'Upload needs attention', tone: 'danger' },
    );
  });

  it('#8 state capturing -> Recording (outranks everything else)', () => {
    expect(recordingBadge(rec({ state: 'capturing', mergeState: 'not-needed', uploadState: null }), {}, NOW))
      .toMatchObject({ label: 'Recording', tone: 'record' });
  });

  it('#9 aged past retentionDeleteAfter with uploadState != done -> "Kept" as a SECOND line, not a replacement', () => {
    const badge = recordingBadge(
      rec({ mergeState: 'done', uploadState: 'failed', retentionDeleteAfter: PAST }),
      { nextAttemptAt: '14:20' },
      NOW,
    );
    expect(badge.label).toBe('Upload failed — retrying (next try 14:20)');
    expect(badge.secondary).toBe("Kept — never uploaded (won't auto-delete)");
  });

  it('#9 does not fire when uploadState is done, even if aged past retention', () => {
    const badge = recordingBadge(rec({ mergeState: 'done', uploadState: 'done', retentionDeleteAfter: PAST }), {}, NOW);
    expect(badge.secondary).toBeUndefined();
  });

  it('precedence: a merging recording with uploadState failed reads Preparing…, not the upload label', () => {
    const badge = recordingBadge(
      rec({ mergeState: 'running', uploadState: 'failed' }),
      { nextAttemptAt: '14:20' },
      NOW,
    );
    expect(badge.label).toBe('Preparing…');
  });
});
