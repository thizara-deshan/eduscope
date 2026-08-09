import { act, createElement, type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import { ClientContext } from '../client/client-provider.js';
import { useWsStore } from '../store/ws-store.js';
import { useQuizSession } from './use-quiz-session.js';

const session = (overrides: Record<string, unknown> = {}) => ({
  state: 'open', quizSessionId: '01J00000000000000000000009', lectureSessionId: '01J00000000000000000000001',
  joinUrl: 'https://quiz.eduscope.local/j/482913', joinCode: '482913', joinedCount: 3, syncState: 'synced', ...overrides,
});

const envelope = (event: string, payload: unknown, seq: number) =>
  ({ event, at: '2026-08-05T10:00:00+00:00', seq, payload }) as never;

function build(methods: Partial<EduscopeClient> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const stub = {
    getQuizSession: vi.fn(() => Promise.resolve(session())),
    ...methods,
  } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider, { client: queryClient }, createElement(ClientContext.Provider, { value: stub, children }),
  );
  return { hook: renderHook(() => useQuizSession(), { wrapper }), client: stub };
}

describe('useQuizSession', () => {
  beforeEach(() => useWsStore.getState().reset());

  it('loads the REST snapshot when no WS event has arrived', async () => {
    const { hook } = build();
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.state).toBe('open');
    expect(hook.result.current.joinedCount).toBe(3);
  });

  it('WS supersedes the REST snapshot', async () => {
    const { hook } = build();
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    act(() => useWsStore.getState().ingest(envelope('quiz.session', session({ joinedCount: 9, syncState: 'stale' }), 0)));
    expect(hook.result.current.joinedCount).toBe(9);
    expect(hook.result.current.syncState).toBe('stale');
  });

  it('absent when the REST snapshot says so', async () => {
    const { hook } = build({
      getQuizSession: vi.fn(() => Promise.resolve({
        state: 'absent', quizSessionId: null, lectureSessionId: null, joinUrl: null, joinCode: null, joinedCount: 0, syncState: null,
      })) as unknown as EduscopeClient['getQuizSession'],
    });
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.state).toBe('absent');
  });
});
