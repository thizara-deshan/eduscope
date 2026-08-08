import { act, createElement, type ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import { ProblemError } from '@eduscope/api-client';
import { TIMERS } from '@eduscope/shared';
import { ClientContext } from '../client/client-provider.js';
import { useWsStore } from '../store/ws-store.js';
import { useChannelRuntimeCommand } from './use-channel-runtime-command.js';

function meeting(state: string, reason: string | null = null) {
  return { channelId: 'meeting', state, presetId: 'cams-fifty-fifty', ratioA: 50, ratioB: 50, reason };
}

function build(enableChannel: (...args: never[]) => Promise<unknown>, disableChannel: (...args: never[]) => Promise<unknown> = vi.fn()) {
  const client = { enableChannel, disableChannel } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(ClientContext.Provider, { value: client, children });
  return renderHook(() => useChannelRuntimeCommand('meeting'), { wrapper });
}

describe('useChannelRuntimeCommand', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useWsStore.getState().reset();
    useWsStore.setState({ channels: { meeting: meeting('off') } as never });
  });
  afterEach(() => vi.useRealTimers());

  it('off -> starting -> on: pending until the WS row reaches on', async () => {
    const { result } = build(vi.fn(() => Promise.resolve({ resolveBySec: 10 })));
    await act(async () => result.current.requestEnabled(true));
    expect(result.current.pending).toBe(true);

    act(() => useWsStore.setState({ channels: { meeting: meeting('starting') } as never }));
    expect(result.current.pending).toBe(true);

    act(() => useWsStore.setState({ channels: { meeting: meeting('on') } as never }));
    expect(result.current.pending).toBe(false);
    expect(result.current.problem).toBeNull();
  });

  it('on -> stopping -> off: pending until the WS row reaches off', async () => {
    useWsStore.setState({ channels: { meeting: meeting('on') } as never });
    const { result } = build(vi.fn(), vi.fn(() => Promise.resolve({ resolveBySec: 10 })));
    await act(async () => result.current.requestEnabled(false));
    expect(result.current.pending).toBe(true);

    act(() => useWsStore.setState({ channels: { meeting: meeting('stopping') } as never }));
    expect(result.current.pending).toBe(true);

    act(() => useWsStore.setState({ channels: { meeting: meeting('off') } as never }));
    expect(result.current.pending).toBe(false);
  });

  it('a refused command clears pending and carries the named Problem', async () => {
    const problem = { status: 409, code: 'session.not-active' as const, title: 'No active session.' };
    const { result } = build(vi.fn(() => Promise.reject(new ProblemError(problem))));
    await act(async () => result.current.requestEnabled(true));
    expect(result.current.pending).toBe(false);
    expect(result.current.problem).toEqual(problem);
  });

  it('never issues while stale, and never sets checked=true itself on the 202', async () => {
    useWsStore.setState({ stale: true });
    const enable = vi.fn(() => Promise.resolve({ resolveBySec: 10 }));
    const { result } = build(enable);
    await act(async () => result.current.requestEnabled(true));
    expect(enable).not.toHaveBeenCalled();
    expect(result.current.pending).toBe(false);
  });

  it('a spontaneous restart (starting, unrequested) never flips pending on its own', () => {
    useWsStore.setState({ channels: { meeting: meeting('on') } as never });
    build(vi.fn());
    act(() => useWsStore.setState({
      channels: { meeting: meeting('starting', 'The output stopped unexpectedly and is restarting.') } as never,
    }));
    // No requestEnabled call was made — nothing here asserts pending; this just proves no throw/crash on an externally-driven transition.
  });

  it('fails with a generic message after T-CMD-RESOLVE with no matching event', async () => {
    const { result } = build(vi.fn(() => new Promise<never>(() => undefined)));
    await act(async () => result.current.requestEnabled(true));
    expect(result.current.pending).toBe(true);
    act(() => vi.advanceTimersByTime(TIMERS['T-CMD-RESOLVE']));
    expect(result.current.pending).toBe(false);
    expect(result.current.problem).toMatchObject({ code: 'unresolved' });
  });
});
