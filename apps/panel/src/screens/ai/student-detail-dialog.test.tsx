import { act, createElement, type ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import type { Leaderboard, PublicationWithQuestion } from '@eduscope/shared';
import { ClientContext } from '../../client/client-provider.js';
import { useWsStore } from '../../store/ws-store.js';
import '../../styles/tokens.css';
import { StudentDetailDialog } from './student-detail-dialog.js';

const recording = () => ({
  state: 'recording', startReason: 'initial', sessionId: '01J00000000000000000000001',
  title: 'Lecture', ownerUserId: 'u1', ownerDisplayName: 'A. Perera',
  startedAt: '2026-08-05T10:00:00Z', recordedDurationMs: 0, segmentIndex: 1,
  segmentCount: 1, pauseCount: 0, takeoverBy: null, takeoverAt: null,
  takeoverByDisplayName: null, errorCode: null, errorMessage: null,
});

const leaderboard = (overrides: Partial<Leaderboard> = {}): Leaderboard => ({
  sessionId: '01J00000000000000000000001',
  entries: [{ studentIdNumber: 's1', displayName: 'K. Fernando', answered: 2, correct: 1, points: 10, accuracy: 0.5, avgResponseMs: 3000, rank: 1 }],
  computedAt: '2026-08-05T10:00:00Z', stale: false, ...overrides,
});

const publication = (overrides: Partial<PublicationWithQuestion> = {}): PublicationWithQuestion => ({
  id: 'pub1', questionId: 'q1', quizSessionId: 'qs1', state: 'closed',
  publishedAt: '2026-08-05T10:00:00Z', closedAt: '2026-08-05T10:01:00Z', closeReason: 'next-question',
  isShowing: false, projectorState: 'not-shown', syncState: 'synced',
  question: {
    id: 'q1', sessionId: '01J00000000000000000000001', questionSetId: 'set1', kind: 'mcq',
    prompt: 'Question 1?', options: [{ id: 'o1', questionId: 'q1', label: 'A', text: 'Right', position: 0 }],
    correctOptionId: 'o1', provenance: 'generated', edited: false, state: 'closed',
    createdAt: '2026-08-05T10:00:00Z', orderHint: 0,
  },
  responseCount: 1, correctCount: 1, incorrectCount: 0,
  ...overrides,
});

const openQuizSession = () => ({
  state: 'open', quizSessionId: '01J00000000000000000000009', lectureSessionId: '01J00000000000000000000001',
  joinUrl: 'https://q/1', joinCode: '111111', joinedCount: 1, syncState: 'synced',
});

const envelope = (event: string, payload: unknown, seq: number) =>
  ({ event, at: '2026-08-05T10:00:00+00:00', seq, payload }) as never;

function renderDialog(methods: Partial<EduscopeClient> = {}, onClose = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = {
    getLeaderboard: vi.fn(() => Promise.resolve(leaderboard())),
    getQuizSession: vi.fn(() => Promise.resolve(openQuizSession())),
    listPublications: vi.fn(() => Promise.resolve([])),
    listPublicationResponses: vi.fn(() => Promise.resolve({ items: [], syncedAt: '2026-08-05T10:00:00Z', stale: false })),
    ...methods,
  } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider, { client: queryClient }, createElement(ClientContext.Provider, { value: client, children }),
  );
  return { ...render(<StudentDetailDialog studentIdNumber="s1" onClose={onClose} />, { wrapper }), onClose };
}

describe('StudentDetailDialog', () => {
  beforeEach(() => {
    useWsStore.getState().reset();
    useWsStore.setState({ recording: recording() as never });
  });

  it('loading then populated: per-question history with the running score and rank', async () => {
    renderDialog({
      listPublications: vi.fn(() => Promise.resolve([publication()])),
      listPublicationResponses: vi.fn(() => Promise.resolve({
        items: [{
          id: 'a1', publicationId: 'pub1', studentIdNumber: 's1', studentDisplayName: 'K. Fernando',
          selectedOptionId: 'o1', isCorrect: true, responseTimeMs: 3000, submittedAt: '2026-08-05T10:00:00Z',
          syncedAt: '2026-08-05T10:00:00Z',
        }],
        syncedAt: '2026-08-05T10:00:00Z', stale: false,
      })),
    });
    expect(screen.getByTestId('student-detail-loading')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('student-detail-row-pub1')).toBeInTheDocument());
    expect(screen.getByTestId('student-detail-score')).toHaveTextContent('Score 10');
    expect(screen.getByTestId('student-detail-rank')).toHaveTextContent('Rank #1');
    expect(screen.getByTestId('student-detail-row-pub1')).toHaveTextContent('Correct');
  });

  it('partial: a late-joiner\'s missed question renders unanswered, not incorrect', async () => {
    renderDialog({
      listPublications: vi.fn(() => Promise.resolve([
        publication({ id: 'pub1' }),
        publication({ id: 'pub2', questionId: 'q2' }),
      ])),
      listPublicationResponses: vi.fn((publicationId: string) => Promise.resolve({
        items: publicationId === 'pub1' ? [{
          id: 'a1', publicationId: 'pub1', studentIdNumber: 's1', studentDisplayName: 'K. Fernando',
          selectedOptionId: 'o1', isCorrect: true, responseTimeMs: 3000, submittedAt: '2026-08-05T10:00:00Z',
          syncedAt: '2026-08-05T10:00:00Z',
        }] : [],
        syncedAt: '2026-08-05T10:00:00Z', stale: false,
      }) as never),
    });
    await waitFor(() => expect(screen.getByTestId('student-detail-row-pub2')).toBeInTheDocument());
    expect(screen.getByTestId('student-detail-row-pub2')).toHaveTextContent('Unanswered');
    expect(screen.getByTestId('student-detail-partial')).toBeInTheDocument();
  });

  it('stale: marks the data without fabricating', async () => {
    renderDialog({
      listPublications: vi.fn(() => Promise.resolve([publication()])),
      listPublicationResponses: vi.fn(() => Promise.resolve({ items: [], syncedAt: '2026-08-05T09:58:00Z', stale: true })),
    });
    await waitFor(() => expect(screen.getByTestId('student-detail-row-pub1')).toBeInTheDocument());
    expect(screen.getByTestId('student-detail-stale')).toBeInTheDocument();
  });

  it('a live quiz.responses delta updates the matching row', async () => {
    renderDialog({ listPublications: vi.fn(() => Promise.resolve([publication()])) });
    await waitFor(() => expect(screen.getByTestId('student-detail-row-pub1')).toBeInTheDocument());
    expect(screen.getByTestId('student-detail-row-pub1')).toHaveTextContent('Unanswered');
    act(() => useWsStore.getState().ingest(envelope('quiz.responses', {
      publicationId: 'pub1',
      deltas: [{ studentIdNumber: 's1', displayName: 'K. Fernando', selectedOptionId: 'o1', isCorrect: false, responseTimeMs: 2500, submittedAt: '2026-08-05T10:02:00Z' }],
      syncedAt: '2026-08-05T10:02:00Z', stale: false,
    }, 0)));
    expect(screen.getByTestId('student-detail-row-pub1')).toHaveTextContent('Incorrect');
  });

  it('close (✕) invokes onClose', async () => {
    const { onClose } = renderDialog();
    await waitFor(() => expect(screen.queryByTestId('student-detail-loading')).toBeNull());
    screen.getByRole('button', { name: 'Close' }).click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
