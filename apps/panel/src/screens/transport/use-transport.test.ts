import { act, createElement, type ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import { TIMERS, type User } from '@eduscope/shared';
import { AuthProvider } from '../../auth/auth-context.js';
import { ClientContext } from '../../client/client-provider.js';
import { useWsStore } from '../../store/ws-store.js';
import { useTransport } from './use-transport.js';

const me: User = {
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', username: 'a.perera', displayName: 'A. Perera',
  role: 'lecturer', source: 'institute', mustResetPassword: false, disabled: false,
  lastLoginAt: null, createdAt: '2026-01-01T00:00:00.000Z',
};
const session = (overrides: Record<string, unknown> = {}) => ({
  state: 'recording', startReason: 'initial', sessionId: me.id, title: 'Lecture',
  ownerUserId: me.id, ownerDisplayName: me.displayName, startedAt: '2026-08-05T10:00:00Z',
  recordedDurationMs: 0, segmentIndex: 1, segmentCount: 1, pauseCount: 0,
  takeoverBy: null, takeoverAt: null, takeoverByDisplayName: null,
  errorCode: null, errorMessage: null, ...overrides,
});

function renderTransport(methods: Partial<EduscopeClient> = {}) {
  const defaults = {
    pauseRecording: vi.fn(() => Promise.resolve({ resolveBySec: 10 })),
    resumeRecording: vi.fn(() => Promise.resolve({ resolveBySec: 10 })),
    stopRecording: vi.fn(() => Promise.resolve({ resolveBySec: 10 })),
  };
  const client = { ...defaults, ...methods } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    ClientContext.Provider,
    { value: client },
    createElement(AuthProvider, { initialUser: me, children }),
  );
  return { ...renderHook(() => useTransport(), { wrapper }), client };
}

describe('useTransport', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useWsStore.getState().reset();
    useWsStore.setState({ recording: session() as never });
  });
  afterEach(() => vi.useRealTimers());

  it.each([
    ['pause', 'pauseRecording'], ['resume', 'resumeRecording'], ['stop', 'stopRecording'],
  ] as const)('%s issues only its own command and marks itself pending', (command, method) => {
    const { result, client } = renderTransport();
    act(() => result.current.run(command));
    expect(result.current.pending).toBe(command);
    expect(client[method]).toHaveBeenCalledTimes(1);
  });

  it('the matching recording state clears pending', () => {
    const { result } = renderTransport();
    act(() => result.current.run('pause'));
    act(() => useWsStore.setState({ recording: session({ state: 'paused' }) as never }));
    expect(result.current.pending).toBeNull();
  });

  it('T-CMD-RESOLVE produces a failure', () => {
    const { result } = renderTransport();
    act(() => result.current.run('stop'));
    act(() => vi.advanceTimersByTime(TIMERS['T-CMD-RESOLVE']));
    expect(result.current.failure).toMatch(/did not resolve/i);
  });

  it('locks out non-owners and stale panels, and never queues an offline command', () => {
    useWsStore.setState({ recording: session({ ownerUserId: '01ARZ3NDEKTSV4RRFFQ69G5FAA' }) as never });
    const other = renderTransport();
    expect(other.result.current.canCommand).toBe(false);
    other.unmount();

    useWsStore.setState({ recording: session() as never, stale: true });
    const stale = renderTransport();
    expect(stale.result.current.canCommand).toBe(false);
    act(() => stale.result.current.run('stop'));
    expect(stale.client.stopRecording).not.toHaveBeenCalled();
  });

  it('grants command authority to the administrator named by takeoverBy', () => {
    useWsStore.setState({ recording: session({
      ownerUserId: '01ARZ3NDEKTSV4RRFFQ69G5FAA',
      takeoverBy: me.id,
    }) as never });
    const { result, client } = renderTransport();
    expect(result.current.canCommand).toBe(true);
    act(() => result.current.run('stop'));
    expect(client.stopRecording).toHaveBeenCalledTimes(1);
  });
});
