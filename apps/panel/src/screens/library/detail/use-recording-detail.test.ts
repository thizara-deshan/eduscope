import { act, createElement, type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import { ProblemError } from '@eduscope/api-client';
import type { RecordingDetail } from '@eduscope/shared';
import { ClientContext } from '../../../client/client-provider.js';
import { useWsStore } from '../../../store/ws-store.js';
import { useRecordingDetail } from './use-recording-detail.js';

const envelope = (event: string, payload: unknown, seq: number) =>
  ({ event, at: '2026-08-10T10:00:00+00:00', seq, payload }) as never;

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

function build(getRecording: EduscopeClient['getRecording']) {
  useWsStore.getState().reset();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const stub = { getRecording } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider, { client: queryClient }, createElement(ClientContext.Provider, { value: stub, children }),
  );
  return wrapper;
}

describe('useRecordingDetail (S-22)', () => {
  beforeEach(() => {
    useWsStore.getState().reset();
  });

  it('404 -> not-found', async () => {
    const getRecording = vi.fn(() => Promise.reject(
      new ProblemError({ status: 404, code: 'not-found', title: 'gone' }),
    ));
    const wrapper = build(getRecording);
    const { result } = renderHook(() => useRecordingDetail('R1'), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('not-found'));
  });

  it('403 -> forbidden', async () => {
    const getRecording = vi.fn(() => Promise.reject(
      new ProblemError({ status: 403, code: 'not-authorized', title: 'no access' }),
    ));
    const wrapper = build(getRecording);
    const { result } = renderHook(() => useRecordingDetail('R1'), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('forbidden'));
  });

  it('200 -> ready with segments/files', async () => {
    const getRecording = vi.fn(() => Promise.resolve(detail()));
    const wrapper = build(getRecording);
    const { result } = renderHook(() => useRecordingDetail('R1'), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.detail?.segments).toHaveLength(1);
    expect(result.current.detail?.files).toHaveLength(1);
  });

  it('a live recording.artifact{deleted} while mounted -> deleted', async () => {
    const getRecording = vi.fn(() => Promise.resolve(detail()));
    const wrapper = build(getRecording);
    const { result } = renderHook(() => useRecordingDetail('R1'), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    act(() => {
      useWsStore.getState().ingest(envelope('recording.artifact', {
        recordingId: 'R1', sessionId: 'S1', state: 'deleted', mergeState: 'done',
        durationMs: 2_880_000, totalBytes: 2_100_000_000, deleteReason: 'admin',
      }, 0));
    });

    await waitFor(() => expect(result.current.status).toBe('deleted'));
  });

  it('a live recording.artifact{merging} after a retry re-derives to ready with mergeState running (refetches)', async () => {
    const getRecording = vi.fn()
      .mockResolvedValueOnce(detail({ mergeState: 'failed', state: 'failed' }))
      .mockResolvedValueOnce(detail({ mergeState: 'running', state: 'merging' }));
    const wrapper = build(getRecording as unknown as EduscopeClient['getRecording']);
    const { result } = renderHook(() => useRecordingDetail('R1'), { wrapper });
    await waitFor(() => expect(result.current.detail?.mergeState).toBe('failed'));

    act(() => {
      useWsStore.getState().ingest(envelope('recording.artifact', {
        recordingId: 'R1', sessionId: 'S1', state: 'merging', mergeState: 'running',
        durationMs: null, totalBytes: null, deleteReason: null,
      }, 0));
    });

    await waitFor(() => expect(result.current.detail?.mergeState).toBe('running'));
    expect(getRecording).toHaveBeenCalledTimes(2);
  });
});
