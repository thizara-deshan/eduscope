import { act, createElement, type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import type { PublicationWithQuestion } from '@eduscope/shared';
import { ClientContext } from '../client/client-provider.js';
import { useWsStore } from '../store/ws-store.js';
import { useInsights } from './use-insights.js';

const recording = () => ({
  state: 'recording', startReason: 'initial', sessionId: '01J00000000000000000000001',
  title: 'Lecture', ownerUserId: 'u1', ownerDisplayName: 'A. Perera',
  startedAt: '2026-08-05T10:00:00Z', recordedDurationMs: 0, segmentIndex: 1,
  segmentCount: 1, pauseCount: 0, takeoverBy: null, takeoverAt: null,
  takeoverByDisplayName: null, errorCode: null, errorMessage: null,
});

const publication = (overrides: Partial<PublicationWithQuestion> = {}): PublicationWithQuestion => ({
  id: 'pub1', questionId: 'q1', quizSessionId: 'qs1', state: 'open',
  publishedAt: '2026-08-05T10:00:00Z', closedAt: null, closeReason: null,
  isShowing: true, projectorState: 'showing', syncState: 'synced',
  question: {
    id: 'q1', sessionId: '01J00000000000000000000001', questionSetId: 'set1', kind: 'mcq',
    prompt: 'Prompt?', options: [
      { id: 'o1', questionId: 'q1', label: 'A', text: 'Right', position: 0 },
      { id: 'o2', questionId: 'q1', label: 'B', text: 'Wrong', position: 1 },
    ], correctOptionId: 'o1', provenance: 'generated', edited: false, state: 'sent',
    createdAt: '2026-08-05T10:00:00Z', orderHint: 0,
  },
  responseCount: 10, correctCount: 6, incorrectCount: 4,
  ...overrides,
});

const envelope = (event: string, payload: unknown, seq: number) =>
  ({ event, at: '2026-08-05T10:00:00+00:00', seq, payload }) as never;

function build(methods: Partial<EduscopeClient> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const stub = {
    listPublications: vi.fn(() => Promise.resolve([])),
    closePublication: vi.fn(() => Promise.resolve({ commandId: 'c', acceptedAt: '2026-08-05T10:00:00Z', resolveBySec: 10 })),
    setProjector: vi.fn(() => Promise.resolve({ commandId: 'c', acceptedAt: '2026-08-05T10:00:00Z', resolveBySec: 10 })),
    ...methods,
  } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider, { client: queryClient }, createElement(ClientContext.Provider, { value: stub, children }),
  );
  return { hook: renderHook(() => useInsights(), { wrapper }), client: stub };
}

describe('useInsights', () => {
  beforeEach(() => {
    useWsStore.getState().reset();
    useWsStore.setState({ recording: recording() as never });
  });

  it('empty: the column starts empty', async () => {
    const { hook } = build();
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.publications).toHaveLength(0);
  });

  it('populated: exactly one card carries isShowing (Now showing)', async () => {
    const { hook } = build({
      listPublications: vi.fn(() => Promise.resolve([
        publication({ id: 'pub1', isShowing: true }),
        publication({ id: 'pub2', questionId: 'q2', isShowing: false, state: 'closed' }),
      ])),
    });
    await waitFor(() => expect(hook.result.current.publications).toHaveLength(2));
    const showing = hook.result.current.publications.filter((p) => p.isShowing);
    expect(showing).toHaveLength(1);
    expect(showing[0]!.publicationId).toBe('pub1');
  });

  it('withdrawn: still open, isShowing false after Q-36 withdraws to slides', async () => {
    const { hook } = build({ listPublications: vi.fn(() => Promise.resolve([publication()])) });
    await waitFor(() => expect(hook.result.current.publications).toHaveLength(1));
    act(() => useWsStore.getState().ingest(envelope('quiz.publication', {
      publicationId: 'pub1', questionId: 'q1', state: 'open', isShowing: false,
      projectorState: 'showing', syncState: 'synced', closeReason: null,
    }, 0)));
    const row = hook.result.current.publications[0]!;
    expect(row.state).toBe('open');
    expect(row.isShowing).toBe(false);
  });

  it('closed: the card states the reason', async () => {
    const { hook } = build({ listPublications: vi.fn(() => Promise.resolve([publication()])) });
    await waitFor(() => expect(hook.result.current.publications).toHaveLength(1));
    act(() => useWsStore.getState().ingest(envelope('quiz.publication', {
      publicationId: 'pub1', questionId: 'q1', state: 'closed', isShowing: false,
      projectorState: 'not-shown', syncState: 'synced', closeReason: 'lecturer-closed',
    }, 0)));
    expect(hook.result.current.publications[0]!.closeReason).toBe('lecturer-closed');
  });

  it('re-projected (reveal): a closed publication with projectorState showing is reveal mode', async () => {
    const { hook } = build({
      listPublications: vi.fn(() => Promise.resolve([publication({ state: 'closed', isShowing: false, closeReason: 'lecturer-closed' })])),
    });
    await waitFor(() => expect(hook.result.current.publications).toHaveLength(1));
    act(() => useWsStore.getState().ingest(envelope('quiz.publication', {
      publicationId: 'pub1', questionId: 'q1', state: 'closed', isShowing: false,
      projectorState: 'showing', syncState: 'synced', closeReason: 'lecturer-closed',
    }, 0)));
    const row = hook.result.current.publications[0]!;
    expect(row.reveal).toBe(true);
    expect(row.state).toBe('closed'); // acceptance not reopened
  });

  it('responses stale: Z-30 marks a publication out of date', async () => {
    const { hook } = build({ listPublications: vi.fn(() => Promise.resolve([publication()])) });
    await waitFor(() => expect(hook.result.current.publications).toHaveLength(1));
    act(() => useWsStore.getState().ingest(envelope('quiz.publication', {
      publicationId: 'pub1', questionId: 'q1', state: 'open', isShowing: true,
      projectorState: 'showing', syncState: 'stale', closeReason: null,
    }, 0)));
    expect(hook.result.current.responsesStale).toBe(true);
  });

  it('sync failed: an uncleared quiz.sync-stale alert flags the degraded state', () => {
    const { hook } = build();
    act(() => useWsStore.getState().ingest(envelope('system.alert', {
      id: 'a1', code: 'quiz.sync-stale', severity: 'error', category: 'System', title: 'quiz.sync-stale',
      detail: null, raisedAt: '2026-08-05T10:00:00Z', clearedAt: null, clearedReason: null,
      acknowledgedBy: null, context: null, relatedEntity: null,
    }, 0)));
    expect(hook.result.current.syncFailed).toBe(true);
  });

  it('publish failed: a Q-32 failed publication is echoed in the list', async () => {
    const { hook } = build({
      listPublications: vi.fn(() => Promise.resolve([publication({ state: 'publishing', isShowing: false })])),
    });
    await waitFor(() => expect(hook.result.current.publications).toHaveLength(1));
    act(() => useWsStore.getState().ingest(envelope('quiz.publication', {
      publicationId: 'pub1', questionId: 'q1', state: 'failed', isShowing: false,
      projectorState: 'not-shown', syncState: 'synced', closeReason: null,
    }, 0)));
    expect(hook.result.current.publications[0]!.state).toBe('failed');
  });

  it('closePublication and reproject/withdraw issue their commands', async () => {
    const { hook, client } = build({ listPublications: vi.fn(() => Promise.resolve([publication()])) });
    await waitFor(() => expect(hook.result.current.publications).toHaveLength(1));
    act(() => hook.result.current.closePublication('pub1'));
    expect(client.closePublication).toHaveBeenCalledWith('pub1');
    act(() => hook.result.current.reproject('pub1'));
    expect(client.setProjector).toHaveBeenCalledWith({ publicationId: 'pub1' });
    act(() => hook.result.current.withdraw());
    expect(client.setProjector).toHaveBeenCalledWith({ publicationId: null });
  });
});
