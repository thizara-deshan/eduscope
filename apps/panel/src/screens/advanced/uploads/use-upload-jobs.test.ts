import { act, createElement, type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import type { UploadJob } from '@eduscope/shared';
import { ClientContext } from '../../../client/client-provider.js';
import { useWsStore } from '../../../store/ws-store.js';
import { useUploadJobs } from './use-upload-jobs.js';

const envelope = (event: string, payload: unknown, seq: number) =>
  ({ event, at: '2026-08-10T10:00:00+00:00', seq, payload }) as never;

function job(overrides: Partial<UploadJob> = {}): UploadJob {
  return {
    id: 'J1', recordingId: 'R1', recordingTitle: 'Lecture', adapterId: 'institute-lms',
    state: 'uploading', attempt: 0, failureClass: null, nextAttemptAt: null,
    lastError: null, lastErrorAt: null, remoteLectureId: null, progressPct: 20,
    blockedBy: null, enqueuedAt: '2026-08-10T09:00:00.000Z', startedAt: '2026-08-10T09:00:00.000Z',
    completedAt: null, requeuedAt: null,
    ...overrides,
  };
}

function build(listUploadJobs: EduscopeClient['listUploadJobs']) {
  useWsStore.getState().reset();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = { listUploadJobs } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider, { client: queryClient }, createElement(ClientContext.Provider, { value: client, children }),
  );
  return wrapper;
}

describe('useUploadJobs (S-35)', () => {
  beforeEach(() => {
    useWsStore.getState().reset();
  });

  it('a live upload.job{progressPct} patches the matching row', async () => {
    const listUploadJobs = vi.fn(() => Promise.resolve({ items: [job({})], nextCursor: null }));
    const wrapper = build(listUploadJobs);
    const { result } = renderHook(() => useUploadJobs({}), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      useWsStore.getState().ingest(envelope('upload.job', {
        jobId: 'J1', recordingId: 'R1', state: 'uploading', attempt: 0,
        failureClass: null, nextAttemptAt: null, progressPct: 75, lastError: null, blockedBy: null,
      }, 0));
    });

    await waitFor(() => expect(result.current.jobs[0]?.progressPct).toBe(75));
  });

  it('a state filter re-issues the query', async () => {
    const listUploadJobs = vi.fn<EduscopeClient['listUploadJobs']>(() => Promise.resolve({ items: [job({})], nextCursor: null }));
    const wrapper = build(listUploadJobs);
    const { rerender } = renderHook(
      ({ state }: { state?: 'dead-letter' }) => useUploadJobs({ state }),
      { wrapper, initialProps: {} },
    );
    await waitFor(() => expect(listUploadJobs).toHaveBeenCalledTimes(1));

    rerender({ state: 'dead-letter' });
    await waitFor(() => expect(listUploadJobs).toHaveBeenCalledTimes(2));
    expect(listUploadJobs.mock.calls[1]![0]).toMatchObject({ state: 'dead-letter' });
  });
});
