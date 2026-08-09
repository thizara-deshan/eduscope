import { act, createElement, type ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import { ClientContext } from '../../client/client-provider.js';
import { OverlayHost, OverlayProvider } from '../../overlays/overlay-host.js';
import { useWsStore } from '../../store/ws-store.js';
import '../../styles/tokens.css';
import { QuizJoinChip } from './quiz-join-chip.js';

const session = (overrides: Record<string, unknown> = {}) => ({
  state: 'open', quizSessionId: '01J00000000000000000000009', lectureSessionId: '01J00000000000000000000001',
  joinUrl: 'https://quiz.eduscope.local/j/482913', joinCode: '482913', joinedCount: 24, syncState: 'synced', ...overrides,
});

const envelope = (event: string, payload: unknown, seq: number) =>
  ({ event, at: '2026-08-05T10:00:00+00:00', seq, payload }) as never;

function renderChip(methods: Partial<EduscopeClient> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = {
    getQuizSession: vi.fn(() => Promise.resolve({
      state: 'absent', quizSessionId: null, lectureSessionId: null, joinUrl: null, joinCode: null, joinedCount: 0, syncState: null,
    })),
    ...methods,
  } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider, { client: queryClient }, createElement(ClientContext.Provider, { value: client },
      createElement(OverlayProvider, null, children)),
  );
  return render(<><QuizJoinChip /><OverlayHost /></>, { wrapper });
}

describe('QuizJoinChip', () => {
  beforeEach(() => useWsStore.getState().reset());

  it('U-1: renders a skeleton before the snapshot resolves', () => {
    renderChip();
    expect(screen.getByTestId('quiz-join-chip')).toHaveAttribute('data-state', 'loading');
  });

  it('absent: renders nothing', async () => {
    renderChip();
    await waitFor(() => expect(screen.queryByTestId('quiz-join-chip')).toBeNull());
  });

  it('requesting: non-interactive "starting…"', () => {
    renderChip();
    act(() => useWsStore.getState().ingest(envelope('quiz.session', session({ state: 'requesting', joinUrl: null, joinCode: null, joinedCount: 0, syncState: null }), 0)));
    const chip = screen.getByTestId('quiz-join-chip');
    expect(chip).toHaveTextContent('Quiz · starting…');
    expect(chip).toBeDisabled();
  });

  it('open: tappable, shows the joined count, and opens the modal', () => {
    renderChip();
    act(() => useWsStore.getState().ingest(envelope('quiz.session', session(), 0)));
    const chip = screen.getByTestId('quiz-join-chip');
    expect(chip).toHaveTextContent('Quiz · 24 joined');
    expect(chip).toBeEnabled();
    fireEvent.click(chip);
    expect(screen.getByTestId('quiz-join-modal')).toBeInTheDocument();
  });

  it('open + stale: the count is marked, not styled live', () => {
    renderChip();
    act(() => useWsStore.getState().ingest(envelope('quiz.session', session({ syncState: 'stale' }), 0)));
    const chip = screen.getByTestId('quiz-join-chip');
    expect(chip).toHaveAttribute('data-stale', 'true');
  });

  it('failed: named reason, tappable to explain', () => {
    renderChip();
    act(() => useWsStore.getState().ingest(envelope('quiz.session', session({
      state: 'failed', joinUrl: null, joinCode: null, joinedCount: 0, syncState: null,
    }), 0)));
    const chip = screen.getByTestId('quiz-join-chip');
    expect(chip).toHaveTextContent('Quiz unavailable');
    expect(chip).toBeEnabled();
  });

  it('closed: unmounts', () => {
    renderChip();
    act(() => useWsStore.getState().ingest(envelope('quiz.session', session({ state: 'closed' }), 0)));
    expect(screen.queryByTestId('quiz-join-chip')).toBeNull();
  });

  it('U-2: the CG-19 live path flips the chip stale without a REST refetch', async () => {
    const getQuizSession = vi.fn(() => Promise.resolve(session())) as unknown as EduscopeClient['getQuizSession'];
    renderChip({ getQuizSession });
    await act(async () => Promise.resolve());
    act(() => useWsStore.getState().ingest(envelope('quiz.session', session({ syncState: 'stale' }), 0)));
    expect(screen.getByTestId('quiz-join-chip')).toHaveAttribute('data-stale', 'true');
    expect(getQuizSession).toHaveBeenCalledTimes(1);
  });

  it('one count, one value: the chip and (once opened) the modal footer agree', () => {
    renderChip();
    act(() => useWsStore.getState().ingest(envelope('quiz.session', session({ joinedCount: 7 }), 0)));
    const chip = screen.getByTestId('quiz-join-chip');
    expect(chip).toHaveTextContent('7 joined');
    fireEvent.click(chip);
    expect(screen.getByTestId('quiz-join-count')).toHaveTextContent('7 joined');
  });
});
