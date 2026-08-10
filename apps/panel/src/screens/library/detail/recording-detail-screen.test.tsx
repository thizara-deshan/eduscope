import { act, createElement, type ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import { ProblemError } from '@eduscope/api-client';
import type { RecordingDetail, User } from '@eduscope/shared';
import { AuthProvider } from '../../../auth/auth-context.js';
import { ClientContext } from '../../../client/client-provider.js';
import { useWsStore } from '../../../store/ws-store.js';
import { RecordingDetailScreen } from './recording-detail-screen.js';

const lecturer: User = {
  id: 'U1', username: 'a.perera', displayName: 'A. Perera', role: 'lecturer',
  source: 'institute', mustResetPassword: false, disabled: false,
  lastLoginAt: null, createdAt: '2026-01-01T00:00:00.000Z',
};
const admin: User = { ...lecturer, id: 'U2', username: 'admin', displayName: 'Administrator', role: 'admin' };

function detail(overrides: Partial<RecordingDetail> = {}): RecordingDetail {
  return {
    id: 'R1', sessionId: 'S1', title: 'Lecture 1', hallDisplayName: 'Hall A',
    ownerUserId: 'U1', ownerDisplayName: 'A. Perera', startedAt: '2026-08-10T09:00:00.000Z',
    endedAt: '2026-08-10T09:48:00.000Z', state: 'ready', layoutPresetId: 'fifty-fifty',
    durationMs: 48 * 60_000, totalBytes: 2_100_000_000, segmentCount: 1,
    mergeState: 'done', uploadState: 'done',
    retentionDeleteAfter: '2026-11-10T09:00:00.000Z',
    deletedAt: null, deleteReason: null,
    segments: [{
      id: 'SEG1', recordingId: 'R1', index: 0, startedAt: '2026-08-10T09:00:00.000Z',
      endedAt: '2026-08-10T09:48:00.000Z', durationMs: 48 * 60_000, endReason: 'stop', state: 'finalized',
    }],
    files: [{
      id: 'F1', recordingId: 'R1', segmentId: 'SEG1', kind: 'merged', streamKey: 'main',
      container: 'mp4', sizeBytes: 2_100_000_000, durationMs: 48 * 60_000, state: 'finalized',
      hasAudio: true, isUploadable: true,
    }],
    ...overrides,
  };
}

const envelope = (event: string, payload: unknown, seq: number) =>
  ({ event, at: '2026-08-10T10:00:00+00:00', seq, payload }) as never;

function renderDetail({
  getRecording,
  viewer = lecturer,
}: {
  getRecording: EduscopeClient['getRecording'];
  viewer?: User;
}) {
  useWsStore.getState().reset();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = { getRecording, getRecordingMedia: vi.fn(() => new Promise<never>(() => undefined)) } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider, { client: queryClient },
    createElement(ClientContext.Provider, { value: client },
      createElement(AuthProvider, { initialUser: viewer, children: createElement(
        MemoryRouter, { initialEntries: ['/library/R1'] }, children,
      ) })),
  );
  return render(
    <Routes>
      <Route path="/library/:recordingId" element={<RecordingDetailScreen />} />
    </Routes>,
    { wrapper },
  );
}

describe('RecordingDetailScreen (S-22)', () => {
  it('loading', () => {
    renderDetail({ getRecording: vi.fn(() => new Promise<never>(() => undefined)) });
    expect(screen.getByTestId('detail-skeleton')).toBeInTheDocument();
  });

  it('not found', async () => {
    renderDetail({ getRecording: vi.fn(() => Promise.reject(new ProblemError({ status: 404, code: 'not-found', title: 'gone' }))) });
    await waitFor(() => expect(screen.getByText('This recording no longer exists.')).toBeInTheDocument());
  });

  it('forbidden', async () => {
    renderDetail({ getRecording: vi.fn(() => Promise.reject(new ProblemError({ status: 403, code: 'not-authorized', title: 'no' }))) });
    await waitFor(() => expect(screen.getByText("You don't have access to this recording.")).toBeInTheDocument());
  });

  it('populated single', async () => {
    renderDetail({ getRecording: vi.fn(() => Promise.resolve(detail())) });
    await waitFor(() => expect(screen.getByText('Lecture 1')).toBeInTheDocument());
    expect(screen.getByText('Uploaded')).toBeInTheDocument();
  });

  it('populated multi shows the stream picker', async () => {
    renderDetail({
      getRecording: vi.fn(() => Promise.resolve(detail({
        files: [
          { id: 'F1', recordingId: 'R1', segmentId: 'SEG1', kind: 'merged', streamKey: 'composite', container: 'mp4', sizeBytes: 1_000, durationMs: 1_000, state: 'finalized', hasAudio: true, isUploadable: true },
          { id: 'F2', recordingId: 'R1', segmentId: 'SEG1', kind: 'merged', streamKey: 'camera-2', container: 'mp4', sizeBytes: 1_000, durationMs: 1_000, state: 'finalized', hasAudio: false, isUploadable: true },
        ],
      }))),
    });
    await waitFor(() => expect(screen.getByText('Lecture 1')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'composite' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'camera-2' })).toBeInTheDocument();
  });

  it('preparing', async () => {
    renderDetail({
      getRecording: vi.fn(() => Promise.resolve(detail({
        mergeState: 'running', state: 'merging',
        files: [{ id: 'F1', recordingId: 'R1', segmentId: 'SEG1', kind: 'segment', streamKey: 'main', container: 'mpegts', sizeBytes: 1_000, durationMs: 1_000, state: 'finalized', hasAudio: true, isUploadable: false }],
      }))),
    });
    await waitFor(() => expect(screen.getByText(/preparing the full recording/)).toBeInTheDocument());
  });

  it('merge failed: admin sees Retry, lecturer does not', async () => {
    const getRecording = vi.fn(() => Promise.resolve(detail({ mergeState: 'failed', state: 'failed' })));
    const { unmount } = renderDetail({ getRecording, viewer: admin });
    await waitFor(() => expect(screen.getByText(/couldn't combine/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Retry preparing' })).toBeInTheDocument();
    unmount();

    renderDetail({ getRecording, viewer: lecturer });
    await waitFor(() => expect(screen.getByText(/couldn't combine/)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Retry preparing' })).not.toBeInTheDocument();
  });

  it('deleted (live event while open)', async () => {
    const getRecording = vi.fn(() => Promise.resolve(detail()));
    renderDetail({ getRecording });
    await waitFor(() => expect(screen.getByText('Lecture 1')).toBeInTheDocument());

    act(() => {
      useWsStore.getState().ingest(envelope('recording.artifact', {
        recordingId: 'R1', sessionId: 'S1', state: 'deleted', mergeState: 'done',
        durationMs: 2_880_000, totalBytes: 2_100_000_000, deleteReason: 'admin',
      }, 0));
    });

    await waitFor(() => expect(screen.getByText('This recording was removed.')).toBeInTheDocument());
  });
});
