import { act, createElement, type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import type { Recording } from '@eduscope/shared';
import { ClientContext } from '../../client/client-provider.js';
import { useWsStore } from '../../store/ws-store.js';
import { useRecordings } from './use-recordings.js';

const envelope = (event: string, payload: unknown, seq: number) =>
  ({ event, at: '2026-08-10T10:00:00+00:00', seq, payload }) as never;

function rec(overrides: Partial<Recording>): Recording {
  return {
    id: 'R1', sessionId: 'S1', title: 'Lecture 1', hallDisplayName: 'Hall A',
    ownerUserId: 'U1', ownerDisplayName: 'A. Perera', startedAt: '2026-08-10T09:00:00.000Z',
    endedAt: '2026-08-10T09:50:00.000Z', state: 'ready', layoutPresetId: 'fifty-fifty',
    durationMs: 3_000_000, totalBytes: 1_000_000, segmentCount: 1,
    mergeState: 'done', uploadState: 'done',
    retentionDeleteAfter: '2026-11-10T09:00:00.000Z',
    deletedAt: null, deleteReason: null,
    ...overrides,
  };
}

function build(listRecordings: EduscopeClient['listRecordings']) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const stub = { listRecordings } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider, { client: queryClient }, createElement(ClientContext.Provider, { value: stub, children }),
  );
  return wrapper;
}

describe('useRecordings (S-21 paged list + live merge)', () => {
  beforeEach(() => {
    useWsStore.getState().reset();
  });

  it('renders exactly the mock page — no client owner-filtering, mixed owners included', async () => {
    const rows = [rec({ id: 'R1', ownerUserId: 'U1' }), rec({ id: 'R2', ownerUserId: 'U2' })];
    const listRecordings = vi.fn(() => Promise.resolve({ items: rows, nextCursor: null }));
    const wrapper = build(listRecordings);

    const { result } = renderHook(() => useRecordings({}), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.rows.map((r) => r.id)).toEqual(['R1', 'R2']);
  });

  it('a filter change re-issues listRecordings with the param and a reset cursor', async () => {
    const listRecordings = vi.fn<EduscopeClient['listRecordings']>(() =>
      Promise.resolve({ items: [rec({})], nextCursor: null }));
    const wrapper = build(listRecordings);

    const { result, rerender } = renderHook(
      ({ filters }) => useRecordings(filters),
      { wrapper, initialProps: { filters: {} as { q?: string } } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    rerender({ filters: { q: 'networks' } });
    await waitFor(() => {
      const lastCall = listRecordings.mock.calls[listRecordings.mock.calls.length - 1]!;
      expect(lastCall[0]).toMatchObject({ q: 'networks' });
      expect(lastCall[0]).not.toHaveProperty('cursor');
    });
  });

  it('a live upload.job{progressPct} for a listed row updates the badge input (uploadState) without a refetch', async () => {
    const listRecordings = vi.fn(() => Promise.resolve({
      items: [rec({ id: 'R1', uploadState: 'uploading' })], nextCursor: null,
    }));
    const wrapper = build(listRecordings);
    const { result } = renderHook(() => useRecordings({}), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      useWsStore.getState().ingest(envelope('upload.job', {
        jobId: 'J1', recordingId: 'R1', state: 'done', attempt: 1,
        failureClass: null, nextAttemptAt: null, progressPct: 100, lastError: null, blockedBy: null,
      }, 0));
    });

    await waitFor(() => expect(result.current.rows[0]?.uploadState).toBe('done'));
    expect(listRecordings).toHaveBeenCalledTimes(1);
  });

  it('a live recording.artifact{deleted, deleteReason} for a listed row moves it to removed', async () => {
    const listRecordings = vi.fn(() => Promise.resolve({ items: [rec({ id: 'R1' })], nextCursor: null }));
    const wrapper = build(listRecordings);
    const { result } = renderHook(() => useRecordings({}), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      useWsStore.getState().ingest(envelope('recording.artifact', {
        recordingId: 'R1', sessionId: 'S1', state: 'deleted', mergeState: 'done',
        durationMs: 3_000_000, totalBytes: 1_000_000, deleteReason: 'disk-pressure',
      }, 0));
    });

    await waitFor(() => expect(result.current.removed).toEqual([{ recordingId: 'R1', deleteReason: 'disk-pressure' }]));
    expect(result.current.rows.some((r) => r.id === 'R1')).toBe(false);
  });

  it('Load-more appends page 2 and existing rows keep their identity (no skeleton flash)', async () => {
    const listRecordings = vi.fn()
      .mockResolvedValueOnce({ items: [rec({ id: 'R1' })], nextCursor: 'p2' })
      .mockResolvedValueOnce({ items: [rec({ id: 'R2' })], nextCursor: null });
    const wrapper = build(listRecordings as unknown as EduscopeClient['listRecordings']);
    const { result } = renderHook(() => useRecordings({}), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows.map((r) => r.id)).toEqual(['R1']);
    expect(result.current.hasMore).toBe(true);

    act(() => result.current.loadMore());

    await waitFor(() => expect(result.current.rows.map((r) => r.id)).toEqual(['R1', 'R2']));
    expect(result.current.hasMore).toBe(false);
  });
});
