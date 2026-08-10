import { describe, expect, it } from 'vitest';
import type { Recording, UploadJob } from '@eduscope/shared';
import { recordingBadge } from '../../library/use-recording-badge.js';
import { uploadRowLabel } from './use-upload-row-label.js';

function job(overrides: Partial<UploadJob>): UploadJob {
  return {
    id: 'J1', recordingId: 'R1', recordingTitle: 'Lecture', adapterId: 'institute-lms',
    state: 'uploading', attempt: 0, failureClass: null, nextAttemptAt: null,
    lastError: null, lastErrorAt: null, remoteLectureId: null, progressPct: 0,
    blockedBy: null, enqueuedAt: '2026-08-10T09:00:00.000Z', startedAt: '2026-08-10T09:00:00.000Z',
    completedAt: null, requeuedAt: null,
    ...overrides,
  };
}

describe('uploadRowLabel (S-35 §3/CG-20) — composes recordingBadge, adds only the offline/server split', () => {
  it('the headline CG-20 test: a connectivity failure and a server failure render different rows', () => {
    const offline = uploadRowLabel(job({
      state: 'failed', failureClass: 'connectivity', attempt: 0,
      nextAttemptAt: '2026-08-10T15:00:00.000Z', lastErrorAt: '2026-08-10T13:40:00.000Z',
    }));
    expect(offline.offline).toBe(true);
    expect(offline.offlineCopy).toMatch(/No attempts used/);
    expect(offline.offlineCopy).not.toMatch(/attempt \d/);

    const server = uploadRowLabel(job({
      state: 'failed', failureClass: 'server', attempt: 3, nextAttemptAt: '2026-08-10T15:10:00.000Z',
    }));
    expect(server.offline).toBe(false);
    expect(server.badge.label).toBe('Upload failed · attempt 3 of 8 · next try 2026-08-10T15:10:00.000Z');

    expect(offline.badge.label).not.toBe(server.badge.label);
  });

  it('a dead-letter job renders badge #7 (danger, "Upload needs attention")', () => {
    const result = uploadRowLabel(job({ state: 'dead-letter', lastError: 'remote host returned 503' }));
    expect(result.badge.label).toBe('Upload needs attention');
    expect(result.badge.tone).toBe('danger');
  });

  it('badge parity with S-21: the same shared states render an identical label to recordingBadge', () => {
    const rec: Pick<Recording, 'state' | 'mergeState' | 'uploadState' | 'retentionDeleteAfter'> = {
      state: 'ready', mergeState: 'done', uploadState: 'done', retentionDeleteAfter: '2099-01-01T00:00:00.000Z',
    };
    const libraryBadge = recordingBadge(rec, {});
    const queueRow = uploadRowLabel(job({ state: 'done', progressPct: 100 }));
    expect(queueRow.badge.label).toBe(libraryBadge.label);
    expect(queueRow.badge.tone).toBe(libraryBadge.tone);

    const uploadingLib = recordingBadge({ ...rec, uploadState: 'uploading' }, { progressPct: 62 });
    const uploadingQueue = uploadRowLabel(job({ state: 'uploading', progressPct: 62 }));
    expect(uploadingQueue.badge.label).toBe(uploadingLib.label);

    const deadLib = recordingBadge({ ...rec, uploadState: 'dead-letter' }, {});
    const deadQueue = uploadRowLabel(job({ state: 'dead-letter' }));
    expect(deadQueue.badge.label).toBe(deadLib.label);
  });
});
