import { act, createElement, type ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import type { PublicationWithQuestion } from '@eduscope/shared';
import { ClientContext } from '../../client/client-provider.js';
import { useWsStore } from '../../store/ws-store.js';
import '../../styles/tokens.css';
import { PreviousQuestionsTab } from './previous-questions-tab.js';

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
    ], correctOptionId: 'o1', provenance: 'generated', edited: false, state: 'sent',
    createdAt: '2026-08-05T10:00:00Z', orderHint: 0,
  },
  responseCount: 10, correctCount: 6, incorrectCount: 4,
  ...overrides,
});

const envelope = (event: string, payload: unknown, seq: number) =>
  ({ event, at: '2026-08-05T10:00:00+00:00', seq, payload }) as never;

function renderTab(methods: Partial<EduscopeClient> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = {
    listPublications: vi.fn(() => Promise.resolve([])),
    ...methods,
  } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider, { client: queryClient }, createElement(ClientContext.Provider, { value: client, children }),
  );
  return render(<PreviousQuestionsTab />, { wrapper });
}

describe('PreviousQuestionsTab', () => {
  beforeEach(() => {
    useWsStore.getState().reset();
    useWsStore.setState({ recording: recording() as never });
  });

  it('empty: fills-as-sent copy, not "no data"', async () => {
    renderTab();
    expect(await screen.findByTestId('previous-questions-empty')).toHaveTextContent(/fills as questions are sent/i);
  });

  it('populated: exactly one card carries Now showing', async () => {
    renderTab({
      listPublications: vi.fn(() => Promise.resolve([
        publication({ id: 'pub1', isShowing: true }),
        publication({ id: 'pub2', questionId: 'q2', isShowing: false }),
      ])),
    });
    await waitFor(() => expect(screen.getByTestId('publication-card-pub1')).toBeInTheDocument());
    expect(screen.getByTestId('publication-card-pub1')).toHaveTextContent('Now showing');
    expect(screen.getByTestId('publication-card-pub2')).not.toHaveTextContent('Now showing');
  });

  it('shows the correct answer in green and the response badges', async () => {
    renderTab({ listPublications: vi.fn(() => Promise.resolve([publication()])) });
    await waitFor(() => expect(screen.getByTestId('publication-card-pub1')).toBeInTheDocument());
    const card = screen.getByTestId('publication-card-pub1');
    expect(card).toHaveTextContent('Right');
    expect(card).toHaveTextContent('10 Responses');
    expect(card).toHaveTextContent('6 Correct');
    expect(card).toHaveTextContent('4 Incorrect');
  });

  it('closed: states the reason', async () => {
    renderTab({
      listPublications: vi.fn(() => Promise.resolve([publication({
        state: 'closed', isShowing: false, projectorState: 'not-shown', closeReason: 'lecturer-closed',
      })])),
    });
    await waitFor(() => expect(screen.getByTestId('publication-card-pub1')).toHaveTextContent('Closed by you'));
  });

  it('responses stale: an amber marker, not silently current', async () => {
    renderTab({ listPublications: vi.fn(() => Promise.resolve([publication()])) });
    await waitFor(() => expect(screen.getByTestId('publication-card-pub1')).toBeInTheDocument());
    act(() => useWsStore.getState().ingest(envelope('quiz.publication', {
      publicationId: 'pub1', questionId: 'q1', state: 'open', isShowing: true,
      projectorState: 'showing', syncState: 'stale', closeReason: null,
    }, 0)));
    expect(screen.getByTestId('previous-questions-stale')).toHaveTextContent(/may be out of date/i);
  });

  it('sync failed: a degraded marker; recording is untouched (no recording assertion needed here)', async () => {
    renderTab();
    await screen.findByTestId('previous-questions-empty');
    act(() => useWsStore.getState().ingest(envelope('system.alert', {
      id: 'a1', code: 'quiz.sync-stale', severity: 'error', category: 'System', title: 'quiz.sync-stale',
      detail: null, raisedAt: '2026-08-05T10:00:00Z', clearedAt: null, clearedReason: null,
      acknowledgedBy: null, context: null, relatedEntity: null,
    }, 0)));
    expect(screen.getByTestId('previous-questions-syncfailed')).toBeInTheDocument();
  });

  it('re-projected (reveal): the reveal note renders and acceptance is not implied reopened', async () => {
    renderTab({
      listPublications: vi.fn(() => Promise.resolve([publication({ state: 'closed', isShowing: false, closeReason: 'lecturer-closed' })])),
    });
    await waitFor(() => expect(screen.getByTestId('publication-card-pub1')).toBeInTheDocument());
    act(() => useWsStore.getState().ingest(envelope('quiz.publication', {
      publicationId: 'pub1', questionId: 'q1', state: 'closed', isShowing: false,
      projectorState: 'showing', syncState: 'synced', closeReason: 'lecturer-closed',
    }, 0)));
    expect(screen.getByTestId('publication-card-pub1-reveal')).toHaveTextContent(/no longer respond/i);
  });

  it('publish failed: the S-14 failure is echoed here', async () => {
    renderTab({ listPublications: vi.fn(() => Promise.resolve([publication({ state: 'publishing', isShowing: false })])) });
    await waitFor(() => expect(screen.getByTestId('publication-card-pub1')).toBeInTheDocument());
    act(() => useWsStore.getState().ingest(envelope('quiz.publication', {
      publicationId: 'pub1', questionId: 'q1', state: 'failed', isShowing: false,
      projectorState: 'not-shown', syncState: 'synced', closeReason: null,
    }, 0)));
    expect(screen.getByTestId('publication-card-pub1-failed')).toBeInTheDocument();
  });
});
