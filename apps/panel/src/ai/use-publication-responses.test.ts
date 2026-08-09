import { act, createElement, type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import { ClientContext } from '../client/client-provider.js';
import { useWsStore } from '../store/ws-store.js';
import { usePublicationResponses } from './use-publication-responses.js';

const envelope = (event: string, payload: unknown, seq: number) =>
  ({ event, at: '2026-08-05T10:00:00+00:00', seq, payload }) as never;

function build(publicationId: string | undefined, methods: Partial<EduscopeClient> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const stub = {
    listPublicationResponses: vi.fn(() => Promise.resolve({ items: [], syncedAt: '2026-08-05T10:00:00Z', stale: false })),
    ...methods,
  } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider, { client: queryClient }, createElement(ClientContext.Provider, { value: stub, children }),
  );
  return { hook: renderHook(() => usePublicationResponses(publicationId), { wrapper }), client: stub };
}

describe('usePublicationResponses', () => {
  beforeEach(() => useWsStore.getState().reset());

  it('loading then empty: nobody answered yet', async () => {
    const { hook } = build('pub1');
    expect(hook.result.current.loading).toBe(true);
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.items).toHaveLength(0);
  });

  it('populated: the REST snapshot rows', async () => {
    const { hook } = build('pub1', {
      listPublicationResponses: vi.fn(() => Promise.resolve({
        items: [{
          id: 'a1', publicationId: 'pub1', studentIdNumber: 's1', studentDisplayName: 'K. Fernando',
          selectedOptionId: 'o1', isCorrect: true, responseTimeMs: 3000, submittedAt: '2026-08-05T10:00:00Z',
          syncedAt: '2026-08-05T10:00:00Z',
        }],
        syncedAt: '2026-08-05T10:00:00Z', stale: false,
      })),
    });
    await waitFor(() => expect(hook.result.current.items).toHaveLength(1));
  });

  it('a matching quiz.responses delta upserts a row by studentIdNumber', async () => {
    const { hook } = build('pub1');
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    act(() => useWsStore.getState().ingest(envelope('quiz.responses', {
      publicationId: 'pub1',
      deltas: [{ studentIdNumber: 's2', displayName: 'S. Jayasuriya', selectedOptionId: 'o2', isCorrect: false, responseTimeMs: 4000, submittedAt: '2026-08-05T10:01:00Z' }],
      syncedAt: '2026-08-05T10:01:00Z', stale: false,
    }, 0)));
    expect(hook.result.current.items).toHaveLength(1);
    expect(hook.result.current.items[0]!.studentIdNumber).toBe('s2');
  });

  it('a quiz.responses event for a DIFFERENT publication is ignored', async () => {
    const { hook } = build('pub1');
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    act(() => useWsStore.getState().ingest(envelope('quiz.responses', {
      publicationId: 'other-pub',
      deltas: [{ studentIdNumber: 's2', displayName: 'S', selectedOptionId: 'o2', isCorrect: false, responseTimeMs: 4000, submittedAt: '2026-08-05T10:01:00Z' }],
      syncedAt: '2026-08-05T10:01:00Z', stale: false,
    }, 0)));
    expect(hook.result.current.items).toHaveLength(0);
  });

  it('stale: carries syncedAt for the banner', async () => {
    const { hook } = build('pub1', {
      listPublicationResponses: vi.fn(() => Promise.resolve({ items: [], syncedAt: '2026-08-05T09:58:00Z', stale: true })),
    });
    await waitFor(() => expect(hook.result.current.stale).toBe(true));
    expect(hook.result.current.syncedAt).toBe('2026-08-05T09:58:00Z');
  });
});
