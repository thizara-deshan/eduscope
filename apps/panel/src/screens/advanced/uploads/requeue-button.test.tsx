import { act, createElement, type ReactNode } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import { ProblemError } from '@eduscope/api-client';
import type { UploadJob } from '@eduscope/shared';
import { ClientContext } from '../../../client/client-provider.js';
import { useWsStore } from '../../../store/ws-store.js';
import { RequeueButton } from './requeue-button.js';

function job(overrides: Partial<UploadJob> = {}): UploadJob {
  return {
    id: 'J1', recordingId: 'R1', recordingTitle: 'Lecture', adapterId: 'institute-lms',
    state: 'dead-letter', attempt: 5, failureClass: 'server', nextAttemptAt: null,
    lastError: 'remote host returned 503', lastErrorAt: null, remoteLectureId: null, progressPct: 0,
    blockedBy: null, enqueuedAt: '2026-08-10T09:00:00.000Z', startedAt: '2026-08-10T09:00:00.000Z',
    completedAt: null, requeuedAt: null,
    ...overrides,
  };
}

const envelope = (event: string, payload: unknown, seq: number) =>
  ({ event, at: '2026-08-10T10:00:00+00:00', seq, payload }) as never;

function renderButton(requeueUploadJob: EduscopeClient['requeueUploadJob']) {
  useWsStore.getState().reset();
  const client = { requeueUploadJob } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(ClientContext.Provider, { value: client, children });
  return render(<RequeueButton job={job({})} />, { wrapper });
}

describe('<RequeueButton/> (S-35 §5.1)', () => {
  it('resolves pending on upload.job{queued}', async () => {
    renderButton(vi.fn(() => new Promise<never>(() => undefined)));
    fireEvent.click(screen.getByRole('button', { name: 'Try again now' }));
    expect(screen.getByRole('button', { name: 'Requeuing…' })).toBeDisabled();

    act(() => {
      useWsStore.getState().ingest(envelope('upload.job', {
        jobId: 'J1', recordingId: 'R1', state: 'queued', attempt: 6,
        failureClass: null, nextAttemptAt: null, progressPct: 0, lastError: null, blockedBy: null,
      }, 0));
    });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Try again now' })).toBeInTheDocument());
  });

  it('a 409 upload.not-requeueable shows the named reason, never re-tappable', async () => {
    renderButton(vi.fn(() => Promise.reject(
      new ProblemError({ status: 409, code: 'upload.not-requeueable', title: 'Only dead-letter jobs can be requeued' }),
    )));
    fireEvent.click(screen.getByRole('button', { name: 'Try again now' }));
    await waitFor(() => expect(screen.getByText('Only dead-letter jobs can be requeued')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Try again now' })).not.toBeInTheDocument();
  });
});
