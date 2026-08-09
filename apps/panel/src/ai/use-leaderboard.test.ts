import { act, createElement, type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import type { Leaderboard } from '@eduscope/shared';
import { ClientContext } from '../client/client-provider.js';
import { useWsStore } from '../store/ws-store.js';
import { useLeaderboard } from './use-leaderboard.js';

const recording = () => ({
  state: 'recording', startReason: 'initial', sessionId: '01J00000000000000000000001',
  title: 'Lecture', ownerUserId: 'u1', ownerDisplayName: 'A. Perera',
  startedAt: '2026-08-05T10:00:00Z', recordedDurationMs: 0, segmentIndex: 1,
  segmentCount: 1, pauseCount: 0, takeoverBy: null, takeoverAt: null,
  takeoverByDisplayName: null, errorCode: null, errorMessage: null,
});

const leaderboard = (overrides: Partial<Leaderboard> = {}): Leaderboard => ({
  sessionId: '01J00000000000000000000001',
  entries: [
    { studentIdNumber: 's1', displayName: 'K. Fernando', answered: 4, correct: 4, points: 40, accuracy: 1, avgResponseMs: 4200, rank: 1 },
    { studentIdNumber: 's2', displayName: 'S. Jayasuriya', answered: 4, correct: 2, points: 20, accuracy: 0.5, avgResponseMs: 5100, rank: 2 },
  ],
  computedAt: '2026-08-05T10:00:00Z', stale: false, ...overrides,
});

const openQuizSession = () => ({
  state: 'open', quizSessionId: '01J00000000000000000000009', lectureSessionId: '01J00000000000000000000001',
  joinUrl: 'https://q/1', joinCode: '111111', joinedCount: 1, syncState: 'synced',
});

const envelope = (event: string, payload: unknown, seq: number) =>
  ({ event, at: '2026-08-05T10:00:00+00:00', seq, payload }) as never;

function build(methods: Partial<EduscopeClient> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const stub = {
    getLeaderboard: vi.fn(() => Promise.resolve(leaderboard())),
    getQuizSession: vi.fn(() => Promise.resolve(openQuizSession())),
    ...methods,
  } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider, { client: queryClient }, createElement(ClientContext.Provider, { value: stub, children }),
  );
  return { hook: renderHook(() => useLeaderboard(), { wrapper }) };
}

describe('useLeaderboard', () => {
  beforeEach(() => {
    useWsStore.getState().reset();
    useWsStore.setState({ recording: recording() as never });
  });

  it('empty: no answers yet', async () => {
    const { hook } = build({ getLeaderboard: vi.fn(() => Promise.resolve(leaderboard({ entries: [] }))) });
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.entries).toHaveLength(0);
  });

  it('populated: ranked rows from the REST snapshot', async () => {
    const { hook } = build();
    await waitFor(() => expect(hook.result.current.entries).toHaveLength(2));
    expect(hook.result.current.entries[0]!.studentIdNumber).toBe('s1');
    expect(hook.result.current.entries[0]!.rank).toBe(1);
  });

  it('ties share a rank (INV-LB-2)', async () => {
    const { hook } = build({
      getLeaderboard: vi.fn(() => Promise.resolve(leaderboard({
        entries: [
          { studentIdNumber: 's1', displayName: 'A', answered: 2, correct: 2, points: 20, accuracy: 1, avgResponseMs: 1000, rank: 1 },
          { studentIdNumber: 's2', displayName: 'B', answered: 2, correct: 2, points: 20, accuracy: 1, avgResponseMs: 1200, rank: 1 },
          { studentIdNumber: 's3', displayName: 'C', answered: 2, correct: 1, points: 10, accuracy: 0.5, avgResponseMs: 900, rank: 3 },
        ],
      }))),
    });
    await waitFor(() => expect(hook.result.current.entries).toHaveLength(3));
    const ranks = Object.fromEntries(hook.result.current.entries.map((e) => [e.studentIdNumber, e.rank]));
    expect(ranks.s1).toBe(1);
    expect(ranks.s2).toBe(1);
    expect(ranks.s3).toBe(3);
  });

  it('live: a quiz.responses delta recomputes score/accuracy without a refetch', async () => {
    const getLeaderboard = vi.fn(() => Promise.resolve(leaderboard()));
    const { hook } = build({ getLeaderboard });
    await waitFor(() => expect(hook.result.current.entries).toHaveLength(2));
    act(() => useWsStore.getState().ingest(envelope('quiz.responses', {
      publicationId: 'pub1',
      deltas: [{ studentIdNumber: 's2', displayName: 'S. Jayasuriya', selectedOptionId: 'o1', isCorrect: true, responseTimeMs: 3000, submittedAt: '2026-08-05T10:05:00Z' }],
      syncedAt: '2026-08-05T10:05:00Z', stale: false,
    }, 0)));
    const s2 = hook.result.current.entries.find((e) => e.studentIdNumber === 's2')!;
    expect(s2.answered).toBe(5);
    expect(s2.correct).toBe(3);
    expect(s2.points).toBe(30);
    expect(hook.result.current.live).toBe(true);
    expect(getLeaderboard).toHaveBeenCalledTimes(1);
  });

  it('stale: quiz.responses.stale marks the whole list out of date', async () => {
    const { hook } = build();
    await waitFor(() => expect(hook.result.current.entries).toHaveLength(2));
    act(() => useWsStore.getState().ingest(envelope('quiz.responses', {
      publicationId: 'pub1', deltas: [], syncedAt: '2026-08-05T10:05:00Z', stale: true,
    }, 0)));
    expect(hook.result.current.stale).toBe(true);
  });

  it('quiz unavailable: an explanatory empty state, not a zero table', async () => {
    const { hook } = build({
      getQuizSession: vi.fn(() => Promise.resolve({
        state: 'failed', quizSessionId: null, lectureSessionId: null, joinUrl: null, joinCode: null,
        joinedCount: 0, syncState: null,
      })) as unknown as EduscopeClient['getQuizSession'],
    });
    await waitFor(() => expect(hook.result.current.quizUnavailable).toBe(true));
  });

  it('accuracy edge case: answered:0 yields accuracy 0, not treated as incorrect', async () => {
    const { hook } = build({
      getLeaderboard: vi.fn(() => Promise.resolve(leaderboard({
        entries: [{ studentIdNumber: 's1', displayName: 'Late Joiner', answered: 0, correct: 0, points: 0, accuracy: 0, avgResponseMs: 0, rank: 1 }],
      }))),
    });
    await waitFor(() => expect(hook.result.current.entries).toHaveLength(1));
    expect(hook.result.current.entries[0]!.accuracy).toBe(0);
  });
});
