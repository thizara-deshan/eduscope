import { createElement, type ReactNode } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import type { UploadJob } from '@eduscope/shared';
import { ClientContext } from '../../../client/client-provider.js';
import { useWsStore } from '../../../store/ws-store.js';
import { UploadQueueScreen } from './upload-queue-screen.js';

function job(overrides: Partial<UploadJob> = {}): UploadJob {
  return {
    id: 'J1', recordingId: 'R1', recordingTitle: 'Lecture 1', adapterId: 'institute-lms',
    state: 'uploading', attempt: 0, failureClass: null, nextAttemptAt: null,
    lastError: null, lastErrorAt: null, remoteLectureId: null, progressPct: 62,
    blockedBy: null, enqueuedAt: '2026-08-10T09:00:00.000Z', startedAt: '2026-08-10T09:00:00.000Z',
    completedAt: null, requeuedAt: null,
    ...overrides,
  };
}

function renderScreen(listUploadJobs: EduscopeClient['listUploadJobs']) {
  useWsStore.getState().reset();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = { listUploadJobs } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider, { client: queryClient }, createElement(ClientContext.Provider, { value: client, children }),
  );
  return render(<UploadQueueScreen />, { wrapper });
}

describe('<UploadQueueScreen/> (S-35)', () => {
  it('loading', () => {
    renderScreen(vi.fn(() => new Promise<never>(() => undefined)));
    expect(screen.getAllByTestId('upload-row-skeleton').length).toBeGreaterThan(0);
  });

  it('empty: "Everything has been uploaded."', async () => {
    renderScreen(vi.fn(() => Promise.resolve({ items: [], nextCursor: null })));
    await waitFor(() => expect(screen.getByText('Everything has been uploaded.')).toBeInTheDocument());
  });

  it('populated: renders job rows', async () => {
    renderScreen(vi.fn(() => Promise.resolve({ items: [job({})], nextCursor: null })));
    await waitFor(() => expect(screen.getByText('Lecture 1')).toBeInTheDocument());
  });

  it('state filter chip re-issues the query', async () => {
    const listUploadJobs = vi.fn(() => Promise.resolve({ items: [job({})], nextCursor: null }));
    renderScreen(listUploadJobs);
    await waitFor(() => expect(screen.getByText('Lecture 1')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'State: Dead-letter' }));
    await waitFor(() => expect(listUploadJobs).toHaveBeenCalledWith(expect.objectContaining({ state: 'dead-letter' })));
  });
});
