import { act, createElement, type ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import { ProblemError } from '@eduscope/api-client';
import { ClientContext } from '../../client/client-provider.js';
import { useWsStore } from '../../store/ws-store.js';
import '../../styles/tokens.css';
import { AiStudioCard } from './ai-studio-card.js';

const session = (overrides: Record<string, unknown> = {}) => ({
  state: 'recording', startReason: 'initial', sessionId: '01J00000000000000000000001',
  title: 'Lecture', ownerUserId: 'u1', ownerDisplayName: 'A. Perera',
  startedAt: '2026-08-05T10:00:00Z', recordedDurationMs: 0, segmentIndex: 1,
  segmentCount: 1, pauseCount: 0, takeoverBy: null, takeoverAt: null,
  takeoverByDisplayName: null, errorCode: null, errorMessage: null, ...overrides,
});

const countdown = (overrides: Record<string, unknown> = {}) => ({
  state: 'armed', remainingMs: 20 * 60_000, nextAt: '2026-08-05T10:20:00Z', intervalMinutes: 20, ...overrides,
});

const envelope = (event: string, payload: unknown, seq: number) =>
  ({ event, at: '2026-08-05T10:00:00+00:00', seq, payload }) as never;

function renderCard(methods: Partial<EduscopeClient> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = {
    getAiCountdown: vi.fn(() => Promise.resolve(countdown())),
    listQuestions: vi.fn(() => Promise.resolve([])),
    generateNow: vi.fn(() => Promise.resolve({ commandId: 'c1', acceptedAt: '2026-08-05T10:00:00Z', resolveBySec: 10 })),
    setAiInterval: vi.fn(() => Promise.resolve({ commandId: 'c2', acceptedAt: '2026-08-05T10:00:00Z', resolveBySec: 10 })),
    ...methods,
  } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider, { client: queryClient }, createElement(ClientContext.Provider, { value: client, children }),
  );
  return { ...render(<AiStudioCard />, { wrapper }), client };
}

describe('AiStudioCard', () => {
  beforeEach(() => {
    useWsStore.getState().reset();
    useWsStore.setState({ recording: session() as never });
  });
  afterEach(() => vi.useRealTimers());

  it('U-1: renders a loading shell before any snapshot arrives', () => {
    renderCard();
    expect(screen.getByTestId('ai-studio-card')).toHaveAttribute('data-state', 'loading');
  });

  it('armed: countdown, interval select (default 20), and an enabled Generate Now', async () => {
    renderCard();
    act(() => useWsStore.getState().ingest(envelope('ai.countdown', countdown(), 0)));
    expect(await screen.findByTestId('ai-studio-card')).toHaveAttribute('data-state', 'armed');
    expect(screen.getByLabelText('Auto-generation interval')).toHaveValue('20');
    expect(screen.getByRole('button', { name: 'Generate Questions Now' })).toBeEnabled();
  });

  it('generating: the button reads Generating… and is disabled', () => {
    renderCard();
    act(() => useWsStore.getState().ingest(envelope('ai.countdown', countdown({ state: 'generating' }), 0)));
    expect(screen.getByRole('button', { name: 'Generating…' })).toBeDisabled();
  });

  it('held: derived from a paused recording — countdown frozen, Generate Now disabled', () => {
    useWsStore.setState({ recording: session({ state: 'paused' }) as never });
    renderCard();
    act(() => useWsStore.getState().ingest(envelope('ai.countdown', countdown(), 0)));
    expect(screen.getByTestId('ai-studio-card')).toHaveAttribute('data-state', 'held');
    expect(screen.getByText(/paused/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate Questions Now' })).toBeDisabled();
  });

  it('degraded: unavailable body with a Retry', () => {
    renderCard();
    act(() => useWsStore.getState().ingest(envelope('ai.countdown', countdown({ state: 'degraded', remainingMs: null, nextAt: null }), 0)));
    expect(screen.getByTestId('ai-studio-degraded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
  });

  it('set ready: green banner with the draft count and Review Questions', () => {
    renderCard();
    act(() => useWsStore.getState().ingest(envelope('ai.countdown', countdown(), 0)));
    act(() => useWsStore.getState().ingest(envelope('ai.set', {
      setId: 's1', sessionId: 'sess1', state: 'ready', trigger: 'countdown', count: 4, error: null, attempt: 0,
    }, 0)));
    const banner = screen.getByTestId('ai-studio-readybanner');
    expect(banner).toHaveTextContent('A new set is ready');
    expect(banner).toHaveTextContent('4 questions');
    expect(screen.getByRole('button', { name: 'Review Questions' })).toBeInTheDocument();
  });

  it('set failed: named reason with a retry', () => {
    renderCard();
    act(() => useWsStore.getState().ingest(envelope('ai.countdown', countdown(), 0)));
    act(() => useWsStore.getState().ingest(envelope('ai.set', {
      setId: 's1', sessionId: 'sess1', state: 'failed', trigger: 'countdown', count: null, error: 'timeout', attempt: 0,
    }, 0)));
    expect(screen.getByTestId('ai-studio-setfailed')).toHaveTextContent('timeout');
  });

  it('superseded: the latest ready set replaces the banner', () => {
    renderCard();
    act(() => useWsStore.getState().ingest(envelope('ai.countdown', countdown(), 0)));
    act(() => useWsStore.getState().ingest(envelope('ai.set', {
      setId: 's1', sessionId: 'sess1', state: 'ready', trigger: 'countdown', count: 4, error: null, attempt: 0,
    }, 0)));
    act(() => useWsStore.getState().ingest(envelope('ai.set', {
      setId: 's2', sessionId: 'sess1', state: 'ready', trigger: 'manual', count: 2, error: null, attempt: 0,
    }, 1)));
    expect(screen.getByTestId('ai-studio-readybanner')).toHaveTextContent('2 questions');
  });

  it('interval change pending (U-4): selecting a new interval shows the pending hint', async () => {
    const { client } = renderCard();
    act(() => useWsStore.getState().ingest(envelope('ai.countdown', countdown(), 0)));
    fireEvent.change(screen.getByLabelText('Auto-generation interval'), { target: { value: '30' } });
    expect(client.setAiInterval).toHaveBeenCalledWith({ intervalMinutes: 30 });
    expect(screen.getByText(/interval updating/i)).toBeInTheDocument();
    act(() => useWsStore.getState().ingest(envelope('ai.countdown', countdown({ intervalMinutes: 30, remainingMs: 30 * 60_000 }), 1)));
    expect(await screen.findByLabelText('Auto-generation interval')).toHaveValue('30');
  });

  it('U-2: a stale connection dims the card', () => {
    renderCard();
    act(() => useWsStore.getState().ingest(envelope('ai.countdown', countdown(), 0)));
    act(() => useWsStore.setState({ stale: true }));
    expect(screen.getByTestId('ai-studio-card')).toHaveAttribute('data-stale', 'true');
  });

  it('U-5: a generateNow refusal renders inline without a spinner', async () => {
    renderCard({
      generateNow: vi.fn(() => Promise.reject(new ProblemError({
        status: 409, code: 'ai.unavailable', title: 'The question service is not responding',
        detail: 'The question service is not responding',
      }))),
    });
    act(() => useWsStore.getState().ingest(envelope('ai.countdown', countdown(), 0)));
    await act(async () => {
      screen.getByRole('button', { name: 'Generate Questions Now' }).click();
      await Promise.resolve();
    });
    expect(await screen.findByTestId('ai-studio-refusal')).toHaveTextContent('The question service is not responding');
    expect(screen.getByRole('button', { name: 'Generate Questions Now' })).toBeEnabled();
  });
});
