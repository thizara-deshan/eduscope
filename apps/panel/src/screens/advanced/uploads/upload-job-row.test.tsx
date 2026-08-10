import { createElement, type ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import type { UploadJob } from '@eduscope/shared';
import { ClientContext } from '../../../client/client-provider.js';
import { UploadJobRow } from './upload-job-row.js';

function job(overrides: Partial<UploadJob>): UploadJob {
  return {
    id: 'J1', recordingId: 'R1', recordingTitle: 'Lecture 6', adapterId: 'institute-lms',
    state: 'uploading', attempt: 0, failureClass: null, nextAttemptAt: null,
    lastError: null, lastErrorAt: null, remoteLectureId: null, progressPct: 20,
    blockedBy: null, enqueuedAt: '2026-08-10T09:00:00.000Z', startedAt: '2026-08-10T09:00:00.000Z',
    completedAt: null, requeuedAt: null,
    ...overrides,
  };
}

function renderRow(theJob: UploadJob) {
  const client = { getUploadJob: vi.fn(() => new Promise<never>(() => undefined)) } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(ClientContext.Provider, { value: client, children });
  return render(<ul><UploadJobRow job={theJob} /></ul>, { wrapper });
}

describe('<UploadJobRow/> (S-35 §5.1)', () => {
  it('the offline row reads "Waiting for the network" with no attempt count; a server-class row shows attempt N of 8 — different rows', () => {
    renderRow(job({ state: 'failed', failureClass: 'connectivity', attempt: 0, lastErrorAt: '2026-08-10T13:40:00.000Z' }));
    expect(screen.getByText(/Waiting for the network/)).toBeInTheDocument();
    expect(screen.queryByText(/attempt \d/)).not.toBeInTheDocument();
  });

  it('a server-class failed row shows attempt N of 8', () => {
    renderRow(job({ state: 'failed', failureClass: 'server', attempt: 3, nextAttemptAt: '2026-08-10T15:10:00.000Z' }));
    expect(screen.getByText(/attempt 3 of 8/)).toBeInTheDocument();
  });

  it('dead-letter is never hidden — present with reason and requeue', () => {
    renderRow(job({ state: 'dead-letter', lastError: 'remote host returned 503' }));
    expect(screen.getByText('remote host returned 503')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again now' })).toBeInTheDocument();
  });

  it('no button matching /cancel/i renders on any row (C-1)', () => {
    renderRow(job({ state: 'uploading' }));
    expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument();
  });

  it('requeue appears only on dead-letter', () => {
    renderRow(job({ state: 'uploading' }));
    expect(screen.queryByRole('button', { name: 'Try again now' })).not.toBeInTheDocument();
  });
});
