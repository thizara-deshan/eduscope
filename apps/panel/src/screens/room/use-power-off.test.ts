import { createElement, StrictMode, type ReactNode } from 'react';
import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import { ProblemError } from '@eduscope/api-client';
import { ClientContext } from '../../client/client-provider.js';
import { OfflineMarker } from '../../shell/offline-marker.js';
import { useWsStore } from '../../store/ws-store.js';
import { POWEROFF_BLOCKED_REASON, usePowerOff } from './use-power-off.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function renderPowerOff(powerOffDevice: EduscopeClient['powerOffDevice'], strict = false) {
  const client = { powerOffDevice } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    ClientContext.Provider,
    { value: client },
    strict ? createElement(StrictMode, null, children) : children,
  );
  return renderHook(() => usePowerOff(), { wrapper });
}

const accepted = { commandId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', acceptedAt: '2026-08-05T10:00:00Z', resolveBySec: 10 };
const open = { phase: 'open', attempt: 0, since: '2026-08-05T10:00:00Z' } as const;
const closed = { phase: 'closed', attempt: 0, since: '2026-08-05T10:00:01Z' } as const;

describe('usePowerOff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useWsStore.getState().reset();
    useWsStore.getState().setConnection(open);
  });
  afterEach(() => vi.useRealTimers());

  it('starts at confirm and issues exactly one command', () => {
    const pending = deferred<typeof accepted>();
    const powerOffDevice = vi.fn(() => pending.promise);
    const { result } = renderPowerOff(powerOffDevice);
    expect(result.current.state).toEqual({ kind: 'confirm' });
    act(() => result.current.confirm());
    expect(result.current.state).toEqual({ kind: 'pending' });
    expect(powerOffDevice).toHaveBeenCalledTimes(1);
  });

  it('does not close or claim completion when the 202 arrives', async () => {
    const { result } = renderPowerOff(vi.fn(() => Promise.resolve(accepted)));
    act(() => result.current.confirm());
    await act(async () => Promise.resolve());
    expect(result.current.state).toEqual({ kind: 'pending' });
    expect(useWsStore.getState().expectedShutdown).toBe(true);
  });

  it('keeps the accepted lifecycle live through the app StrictMode effect replay', async () => {
    const { result } = renderPowerOff(vi.fn(() => Promise.resolve(accepted)), true);
    act(() => result.current.confirm());
    await act(async () => Promise.resolve());
    expect(result.current.state).toEqual({ kind: 'pending' });
    expect(useWsStore.getState().expectedShutdown).toBe(true);
  });

  it('treats a socket close after the 202 as accepted and suppresses U-2', async () => {
    const { result } = renderPowerOff(vi.fn(() => Promise.resolve(accepted)));
    act(() => result.current.confirm());
    await act(async () => Promise.resolve());
    act(() => useWsStore.getState().setConnection(closed));
    expect(result.current.state).toEqual({ kind: 'accepted' });
    expect(useWsStore.getState().stale).toBe(false);
    render(createElement(OfflineMarker));
    expect(screen.queryByTestId('offline-marker')).toBeNull();
  });

  it('renders U-2 normally when the same socket close has no preceding 202', () => {
    useWsStore.getState().setConnection(closed);
    render(createElement(OfflineMarker));
    expect(screen.getByTestId('offline-marker')).toBeInTheDocument();
  });

  it('produces accepted-not-halted, not a failure, when the ceiling elapses live', async () => {
    const { result } = renderPowerOff(vi.fn(() => Promise.resolve({ ...accepted, resolveBySec: 3 })));
    act(() => result.current.confirm());
    await act(async () => Promise.resolve());
    act(() => vi.advanceTimersByTime(3_000));
    expect(result.current.state).toEqual({ kind: 'accepted-not-halted' });
  });

  it('maps poweroff.refused to the shared recording refusal state', async () => {
    const error = new ProblemError({ status: 409, code: 'poweroff.refused', title: POWEROFF_BLOCKED_REASON });
    const { result } = renderPowerOff(vi.fn(() => Promise.reject(error)));
    act(() => result.current.confirm());
    await act(async () => Promise.resolve());
    expect(result.current.state).toEqual({ kind: 'refused-recording' });
    expect(useWsStore.getState().expectedShutdown).toBe(false);
  });

  it('carries another Problem title into refused-other', async () => {
    const error = new ProblemError({ status: 503, code: 'conflict', title: 'The power controller is unavailable.' });
    const { result } = renderPowerOff(vi.fn(() => Promise.reject(error)));
    act(() => result.current.confirm());
    await act(async () => Promise.resolve());
    expect(result.current.state).toEqual({
      kind: 'refused-other', title: 'The power controller is unavailable.',
    });
  });

  it('retries only when explicitly requested and reset clears expected shutdown', async () => {
    const powerOffDevice = vi.fn(() => Promise.resolve({ ...accepted, resolveBySec: 1 }));
    const { result } = renderPowerOff(powerOffDevice);
    act(() => result.current.confirm());
    await act(async () => Promise.resolve());
    act(() => vi.advanceTimersByTime(1_000));
    expect(powerOffDevice).toHaveBeenCalledTimes(1);
    act(() => result.current.retry());
    expect(powerOffDevice).toHaveBeenCalledTimes(2);
    await act(async () => Promise.resolve());
    act(() => useWsStore.getState().reset());
    expect(useWsStore.getState().expectedShutdown).toBe(false);
  });
});
