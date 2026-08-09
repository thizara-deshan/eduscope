import { act, createElement, type ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import type { Leaderboard } from '@eduscope/shared';
import { ClientContext } from '../../client/client-provider.js';
import { useWsStore } from '../../store/ws-store.js';
import '../../styles/tokens.css';
import { LeaderboardTab } from './leaderboard-tab.js';

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
    { studentIdNumber: 's2', displayName: 'S. Jayasuriya', answered: 4, correct: 3, points: 30, accuracy: 0.75, avgResponseMs: 5100, rank: 2 },
    { studentIdNumber: 's3', displayName: 'R. Wickramasinghe', answered: 3, correct: 2, points: 20, accuracy: 0.667, avgResponseMs: 6300, rank: 3 },
  ],
  computedAt: '2026-08-05T10:00:00Z', stale: false, ...overrides,
});

const openQuizSession = () => ({
  state: 'open', quizSessionId: '01J00000000000000000000009', lectureSessionId: '01J00000000000000000000001',
  joinUrl: 'https://q/1', joinCode: '111111', joinedCount: 1, syncState: 'synced',
});

const envelope = (event: string, payload: unknown, seq: number) =>
  ({ event, at: '2026-08-05T10:00:00+00:00', seq, payload }) as never;

function renderTab(methods: Partial<EduscopeClient> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = {
    getLeaderboard: vi.fn(() => Promise.resolve(leaderboard())),
    getQuizSession: vi.fn(() => Promise.resolve(openQuizSession())),
    ...methods,
  } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider, { client: queryClient }, createElement(ClientContext.Provider, { value: client, children }),
  );
  return render(<LeaderboardTab />, { wrapper });
}

describe('LeaderboardTab', () => {
  beforeEach(() => {
    useWsStore.getState().reset();
    useWsStore.setState({ recording: recording() as never });
  });

  it('empty: no answers yet', async () => {
    renderTab({ getLeaderboard: vi.fn(() => Promise.resolve(leaderboard({ entries: [] }))) });
    expect(await screen.findByTestId('leaderboard-empty')).toBeInTheDocument();
  });

  it('populated: ranked rows with medals for the top three, {correct}/{answered}, score, accuracy, avg time', async () => {
    renderTab();
    await waitFor(() => expect(screen.getByTestId('leaderboard-row-s1')).toBeInTheDocument());
    const first = screen.getByTestId('leaderboard-row-s1');
    expect(within(first).getByText('🥇')).toBeInTheDocument();
    expect(first).toHaveTextContent('4/4');
    expect(first).toHaveTextContent('40');
    expect(first).toHaveTextContent('100%');
    expect(first).toHaveTextContent('4s');
  });

  it('live: shows the streaming dot after a non-empty quiz.responses delta', async () => {
    renderTab();
    await waitFor(() => expect(screen.getByTestId('leaderboard-row-s1')).toBeInTheDocument());
    act(() => useWsStore.getState().ingest(envelope('quiz.responses', {
      publicationId: 'pub1',
      deltas: [{ studentIdNumber: 's1', displayName: 'K. Fernando', selectedOptionId: 'o1', isCorrect: true, responseTimeMs: 2000, submittedAt: '2026-08-05T10:05:00Z' }],
      syncedAt: '2026-08-05T10:05:00Z', stale: false,
    }, 0)));
    expect(screen.getByTestId('leaderboard-live-dot')).toBeInTheDocument();
  });

  it('stale: the whole list is marked out of date', async () => {
    renderTab({ getLeaderboard: vi.fn(() => Promise.resolve(leaderboard({ stale: true }))) });
    expect(await screen.findByTestId('leaderboard-stale')).toBeInTheDocument();
  });

  it('quiz unavailable: an explanatory empty state, not a zero table', async () => {
    renderTab({
      getQuizSession: vi.fn(() => Promise.resolve({
        state: 'failed', quizSessionId: null, lectureSessionId: null, joinUrl: null, joinCode: null,
        joinedCount: 0, syncState: null,
      })) as unknown as EduscopeClient['getQuizSession'],
    });
    expect(await screen.findByTestId('leaderboard-quiz-unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('leaderboard-row-s1')).toBeNull();
  });

  it('accuracy edge case: a missed question is unanswered, not incorrect — the header does not imply otherwise', async () => {
    renderTab({
      getLeaderboard: vi.fn(() => Promise.resolve(leaderboard({
        entries: [{ studentIdNumber: 's4', displayName: 'Late Joiner', answered: 0, correct: 0, points: 0, accuracy: 0, avgResponseMs: 0, rank: 1 }],
      }))),
    });
    const row = await screen.findByTestId('leaderboard-row-s4');
    expect(row).toHaveTextContent('0/0');
    expect(row).toHaveTextContent('0%');
  });

  it('is asserted panel-only: no projector affordance of any kind', async () => {
    renderTab();
    await waitFor(() => expect(screen.getByTestId('leaderboard-tab')).toBeInTheDocument());
    expect(screen.getByTestId('leaderboard-tab')).toHaveAttribute('data-panel-only', 'true');
    expect(screen.queryByText(/project/i)).toBeNull();
  });
});
