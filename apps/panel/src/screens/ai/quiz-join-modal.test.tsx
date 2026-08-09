import { act, createElement, type ReactNode } from 'react';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import { ClientContext } from '../../client/client-provider.js';
import { useWsStore } from '../../store/ws-store.js';
import '../../styles/tokens.css';
import { QuizJoinModal } from './quiz-join-modal.js';

const session = (overrides: Record<string, unknown> = {}) => ({
  state: 'open', quizSessionId: '01J00000000000000000000009', lectureSessionId: '01J00000000000000000000001',
  joinUrl: 'https://quiz.eduscope.local/j/482913', joinCode: '482913', joinedCount: 24, syncState: 'synced', ...overrides,
});

const envelope = (event: string, payload: unknown, seq: number) =>
  ({ event, at: '2026-08-05T10:00:00+00:00', seq, payload }) as never;

function renderModal(methods: Partial<EduscopeClient> = {}, onClose = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = {
    getQuizSession: vi.fn(() => Promise.resolve(session())),
    ...methods,
  } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider, { client: queryClient }, createElement(ClientContext.Provider, { value: client, children }),
  );
  return { ...render(<QuizJoinModal onClose={onClose} />, { wrapper }), onClose };
}

describe('QuizJoinModal', () => {
  beforeEach(() => useWsStore.getState().reset());

  it('open: shows the QR, join code, URL, and footer count', async () => {
    renderModal();
    act(() => useWsStore.getState().ingest(envelope('quiz.session', session(), 0)));
    expect(await screen.findByTestId('quiz-join-code')).toHaveTextContent('482913');
    expect(screen.getByTestId('quiz-join-url')).toHaveTextContent('https://quiz.eduscope.local/j/482913');
    expect(screen.getByTestId('quiz-join-count')).toHaveTextContent('24 joined');
    expect(screen.getByRole('img', { name: /join qr/i })).toBeInTheDocument();
  });

  it('stale: QR and code stay put, only the count is marked out of date', () => {
    renderModal();
    act(() => useWsStore.getState().ingest(envelope('quiz.session', session({ syncState: 'stale' }), 0)));
    expect(screen.getByTestId('quiz-join-code')).toHaveTextContent('482913');
    expect(screen.getByTestId('quiz-join-count')).toHaveTextContent('may be out of date');
    expect(screen.getByTestId('quiz-join-freshness')).toHaveTextContent(/last synced/i);
  });

  it('failed: no QR, no Retry — exactly one interactive role (close)', () => {
    renderModal();
    act(() => useWsStore.getState().ingest(envelope('quiz.session', {
      state: 'failed', quizSessionId: null, lectureSessionId: null, joinUrl: null, joinCode: null, joinedCount: 0, syncState: null,
    }, 0)));
    const modal = screen.getByTestId('quiz-join-modal');
    expect(within(modal).getByTestId('quiz-join-failed')).toHaveTextContent(/reconnecting automatically/i);
    expect(within(modal).queryByRole('img')).toBeNull();
    expect(within(modal).queryByRole('button', { name: /retry|reconnect/i })).toBeNull();
    const buttons = within(modal).getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName('Close');
  });

  it('close (✕) invokes onClose', () => {
    const { onClose } = renderModal();
    act(() => useWsStore.getState().ingest(envelope('quiz.session', session(), 0)));
    screen.getByRole('button', { name: 'Close' }).click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clicking the scrim invokes onClose but clicking the panel does not', () => {
    const { onClose, container } = renderModal();
    act(() => useWsStore.getState().ingest(envelope('quiz.session', session(), 0)));
    screen.getByTestId('quiz-join-modal').click();
    expect(onClose).not.toHaveBeenCalled();
    container.querySelector('.us-modal__scrim')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
