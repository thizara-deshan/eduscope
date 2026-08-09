import { act, createElement, type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import { ProblemError } from '@eduscope/api-client';
import { TIMERS } from '@eduscope/shared';
import { ClientContext } from '../client/client-provider.js';
import { useWsStore } from '../store/ws-store.js';
import { useAiStudio } from './use-ai-studio.js';

const session = (overrides: Record<string, unknown> = {}) => ({
  state: 'recording', startReason: 'initial', sessionId: '01J00000000000000000000001',
  title: 'Lecture', ownerUserId: 'u1', ownerDisplayName: 'A. Perera',
  startedAt: '2026-08-05T10:00:00Z', recordedDurationMs: 0, segmentIndex: 1,
  segmentCount: 1, pauseCount: 0, takeoverBy: null, takeoverAt: null,
  takeoverByDisplayName: null, errorCode: null, errorMessage: null, ...overrides,
});

const countdown = (overrides: Record<string, unknown> = {}) => ({
  state: 'armed', remainingMs: 20 * 60_000,
  nextAt: '2026-08-05T10:20:00Z', intervalMinutes: 20, ...overrides,
});

function build(methods: Partial<EduscopeClient> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const stub = {
    getAiCountdown: vi.fn(() => Promise.resolve(countdown())),
    listQuestions: vi.fn(() => Promise.resolve([])),
    generateNow: vi.fn(() => Promise.resolve({ commandId: 'c1', acceptedAt: '2026-08-05T10:00:00Z', resolveBySec: 10 })),
    setAiInterval: vi.fn(() => Promise.resolve({ commandId: 'c2', acceptedAt: '2026-08-05T10:00:00Z', resolveBySec: 10 })),
    ...methods,
  } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider, { client: queryClient }, createElement(ClientContext.Provider, { value: stub, children }),
  );
  return { hook: renderHook(() => useAiStudio(), { wrapper }), client: stub };
}

const envelope = (event: string, payload: unknown, seq: number) =>
  ({ event, at: '2026-08-05T10:00:00+00:00', seq, payload }) as never;

describe('useAiStudio', () => {
  beforeEach(() => {
    useWsStore.getState().reset();
    useWsStore.setState({ recording: session() as never });
  });

  it('loading (U-1): no state until the REST snapshot or WS resolves', async () => {
    const { hook } = build();
    expect(hook.result.current.loading).toBe(true);
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.state).toBe('armed');
  });

  it('WS supersedes the REST snapshot once ingested', async () => {
    const { hook } = build();
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    act(() => useWsStore.getState().ingest(envelope('ai.countdown', countdown({ state: 'degraded', remainingMs: null }), 0)));
    expect(hook.result.current.state).toBe('degraded');
  });

  it('derives `held` from a paused recording, not a machine state', async () => {
    useWsStore.setState({ recording: session({ state: 'paused' }) as never });
    const { hook } = build();
    act(() => useWsStore.getState().ingest(envelope('ai.countdown', countdown(), 0)));
    expect(hook.result.current.state).toBe('held');
  });

  it('unavailable stays unavailable even while paused', async () => {
    useWsStore.setState({ recording: session({ state: 'paused' }) as never });
    const { hook } = build();
    act(() => useWsStore.getState().ingest(envelope('ai.countdown', countdown({ state: 'unavailable', remainingMs: null, nextAt: null }), 0)));
    expect(hook.result.current.state).toBe('unavailable');
  });

  it('a ready ai.set drives setReady and the draft count', async () => {
    const { hook } = build();
    act(() => useWsStore.getState().ingest(envelope('ai.set', {
      setId: 's1', sessionId: 'sess1', state: 'ready', trigger: 'countdown', count: 4, error: null, attempt: 0,
    }, 0)));
    expect(hook.result.current.setReady).toBe(true);
    expect(hook.result.current.draftCount).toBe(4);
  });

  it('a failed ai.set drives setFailed and the error reason', async () => {
    const { hook } = build();
    act(() => useWsStore.getState().ingest(envelope('ai.set', {
      setId: 's1', sessionId: 'sess1', state: 'failed', trigger: 'countdown', count: null, error: 'timeout', attempt: 0,
    }, 0)));
    expect(hook.result.current.setFailed).toBe(true);
    expect(hook.result.current.setErrorReason).toBe('timeout');
  });

  it('superseded: a second ready set replaces the banner (latest wins)', async () => {
    const { hook } = build();
    act(() => useWsStore.getState().ingest(envelope('ai.set', {
      setId: 's1', sessionId: 'sess1', state: 'ready', trigger: 'countdown', count: 4, error: null, attempt: 0,
    }, 0)));
    expect(hook.result.current.draftCount).toBe(4);
    act(() => useWsStore.getState().ingest(envelope('ai.set', {
      setId: 's2', sessionId: 'sess1', state: 'ready', trigger: 'manual', count: 3, error: null, attempt: 0,
    }, 1)));
    expect(hook.result.current.setReady).toBe(true);
    expect(hook.result.current.draftCount).toBe(3);
  });

  it('generateNow issues the command and stays pending until ai.set resolves', async () => {
    const { hook, client } = build();
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    act(() => hook.result.current.generateNow());
    expect(client.generateNow).toHaveBeenCalledTimes(1);
    expect(hook.result.current.generatePending).toBe(true);

    act(() => useWsStore.getState().ingest(envelope('ai.set', {
      setId: 's1', sessionId: 'sess1', state: 'requested', trigger: 'manual', count: null, error: null, attempt: 0,
    }, 0)));
    expect(hook.result.current.generatePending).toBe(true); // requested/generating does not resolve it

    act(() => useWsStore.getState().ingest(envelope('ai.set', {
      setId: 's1', sessionId: 'sess1', state: 'ready', trigger: 'manual', count: 4, error: null, attempt: 0,
    }, 1)));
    expect(hook.result.current.generatePending).toBe(false);
  });

  it('setInterval maps to setAiInterval and stays pending until the next ai.countdown', async () => {
    const { hook, client } = build();
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    act(() => hook.result.current.setInterval(30));
    expect(client.setAiInterval).toHaveBeenCalledWith({ intervalMinutes: 30 });
    expect(hook.result.current.intervalPending).toBe(true);

    act(() => useWsStore.getState().ingest(envelope('ai.countdown', countdown({ intervalMinutes: 30, remainingMs: 30 * 60_000 }), 0)));
    expect(hook.result.current.intervalPending).toBe(false);
    expect(hook.result.current.intervalMinutes).toBe(30);
  });

  it('generateNow refusal (U-5) surfaces the Problem title and clears pending', async () => {
    const refusal = new ProblemError({
      status: 409, code: 'ai.unavailable', title: 'The question service is not responding',
      detail: 'Recording is unaffected. Try again in a moment.',
    });
    const { hook } = build({ generateNow: vi.fn(() => Promise.reject(refusal)) });
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    act(() => hook.result.current.generateNow());
    await waitFor(() => expect(hook.result.current.generatePending).toBe(false));
    expect(hook.result.current.refusal).toBe(refusal.problem.detail);
  });

  it('T-CMD-RESOLVE produces a timeout failure if nothing ever resolves', async () => {
    vi.useFakeTimers();
    try {
      const { hook } = build({ generateNow: vi.fn(() => new Promise<never>(() => {})) });
      act(() => hook.result.current.generateNow());
      act(() => vi.advanceTimersByTime(TIMERS['T-CMD-RESOLVE']));
      expect(hook.result.current.generatePending).toBe(false);
      expect(hook.result.current.refusal).toMatch(/did not resolve/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it('countdown text derives from the absolute nextAt, not a per-second WS event', async () => {
    const { hook } = build();
    act(() => useWsStore.getState().ingest(envelope('ai.countdown', countdown({ nextAt: '2026-08-05T10:20:00Z' }), 0)));
    expect(hook.result.current.nextAt).toBe('2026-08-05T10:20:00Z');
  });
});
