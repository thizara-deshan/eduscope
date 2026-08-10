import { act, createElement, type ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import type { UploadJobDetail } from '@eduscope/shared';
import { ClientContext } from '../../../client/client-provider.js';
import { useWsStore } from '../../../store/ws-store.js';
import { UploadParts } from './upload-parts.js';

const envelope = (event: string, payload: unknown, seq: number) =>
  ({ event, at: '2026-08-10T10:00:00+00:00', seq, payload }) as never;

function detail(): UploadJobDetail {
  return {
    id: 'J1', recordingId: 'R1', recordingTitle: 'Lecture', adapterId: 'institute-lms',
    state: 'uploading', attempt: 0, failureClass: null, nextAttemptAt: null,
    lastError: null, lastErrorAt: null, remoteLectureId: null, progressPct: 20,
    blockedBy: null, enqueuedAt: '2026-08-10T09:00:00.000Z', startedAt: '2026-08-10T09:00:00.000Z',
    completedAt: null, requeuedAt: null,
    parts: [
      { id: 'P1', uploadJobId: 'J1', recordingFileId: 'F1', streamKey: 'main', state: 'uploading', bytesTotal: 1_000_000_000, bytesSent: 200_000_000, attempt: 1, lastError: null },
      { id: 'P2', uploadJobId: 'J1', recordingFileId: 'F2', streamKey: 'camera-2', state: 'missing', bytesTotal: 1_000_000_000, bytesSent: 0, attempt: 1, lastError: null },
    ],
    metadata: {
      title: 'Lecture', hallCode: 'ENG-A301', startedAt: '2026-08-10T09:00:00.000Z',
      endedAt: '2026-08-10T09:48:00.000Z', recordedDurationMs: 2_880_000,
      files: [{ streamKey: 'main', sizeBytes: 1_000, durationMs: 2_880_000, checksum: null }],
    },
  };
}

describe('<UploadParts/> (S-35 §5.1) — read-only (C-2)', () => {
  it('renders bytesSent/bytesTotal per part and names a missing part', async () => {
    useWsStore.getState().reset();
    const client = { getUploadJob: vi.fn(() => Promise.resolve(detail())) } as unknown as EduscopeClient;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => createElement(
      QueryClientProvider, { client: queryClient }, createElement(ClientContext.Provider, { value: client, children }),
    );
    render(<UploadParts jobId="J1" />, { wrapper });

    await waitFor(() => expect(screen.getByText(/200 MB of 1 GB/)).toBeInTheDocument());
    expect(screen.getByText('✕ file missing')).toBeInTheDocument();
  });

  it('a live upload.part event updates the expanded part', async () => {
    useWsStore.getState().reset();
    const client = { getUploadJob: vi.fn(() => Promise.resolve(detail())) } as unknown as EduscopeClient;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => createElement(
      QueryClientProvider, { client: queryClient }, createElement(ClientContext.Provider, { value: client, children }),
    );
    render(<UploadParts jobId="J1" />, { wrapper });
    await waitFor(() => expect(screen.getByText(/200 MB of 1 GB/)).toBeInTheDocument());

    act(() => {
      useWsStore.getState().ingest(envelope('upload.part', {
        partId: 'P1', jobId: 'J1', streamKey: 'main', state: 'uploaded', bytesSent: 1_000_000_000, bytesTotal: 1_000_000_000,
      }, 0));
    });

    await waitFor(() => expect(screen.getByText(/1 GB of 1 GB/)).toBeInTheDocument());
  });
});
