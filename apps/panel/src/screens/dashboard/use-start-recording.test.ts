import { act, createElement, type ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import { ProblemError, TransportError } from '@eduscope/api-client';
import { TIMERS } from '@eduscope/shared';
import { ClientContext } from '../../client/client-provider.js';
import { useWsStore } from '../../store/ws-store.js';
import { useStartRecording } from './use-start-recording.js';

const recording = (overrides: Record<string, unknown> = {}) => ({
  state: 'idle', startReason: null, sessionId: null, title: null,
  ownerUserId: null, ownerDisplayName: null, startedAt: null,
  recordedDurationMs: null, segmentIndex: null, segmentCount: null,
  pauseCount: null, takeoverBy: null, takeoverAt: null,
  takeoverByDisplayName: null, errorCode: null, errorMessage: null,
  ...overrides,
});

function renderStart(startRecording: (...args: never[]) => Promise<unknown>) {
  const client = { startRecording } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(ClientContext.Provider, { value: client, children });
  return renderHook(() => useStartRecording(), { wrapper });
}

describe('useStartRecording', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useWsStore.getState().reset();
    useWsStore.setState({ recording: recording() as never });
  });
  afterEach(() => vi.useRealTimers());

  it('moves ready to starting when start is issued', () => {
    const { result } = renderStart(vi.fn(() => Promise.resolve({ resolveBySec: 10 })));
    act(() => result.current.start());
    expect(result.current.state.kind).toBe('starting');
  });

  it('resolves starting when recording.state becomes recording', () => {
    const { result } = renderStart(vi.fn(() => Promise.resolve({ resolveBySec: 10 })));
    act(() => result.current.start());
    act(() => useWsStore.setState({ recording: recording({ state: 'recording' }) as never }));
    expect(result.current.state.kind).toBe('ready');
  });

  it('fails after T-START-CONFIRM instead of spinning forever', () => {
    const { result } = renderStart(vi.fn(() => Promise.resolve({ resolveBySec: 10 })));
    act(() => result.current.start());
    act(() => vi.advanceTimersByTime(TIMERS['T-START-CONFIRM']));
    expect(result.current.state).toMatchObject({ kind: 'failed' });
    if (result.current.state.kind === 'failed') expect(result.current.state.message.length).toBeGreaterThan(0);
  });

  it('carries storage policy detail through a storage.critical refusal', async () => {
    const problem = { status: 409, code: 'storage.critical', title: 'Storage full', detail: 'Policy limit is 80%.' } as const;
    const { result } = renderStart(vi.fn(() => Promise.reject(new ProblemError(problem))));
    act(() => result.current.start());
    await vi.waitFor(() => expect(result.current.state.kind).toBe('refused'));
    expect(result.current.state).toMatchObject({ kind: 'refused', problem: { detail: 'Policy limit is 80%.' } });
  });

  it('maps config.invalid to a named refusal', async () => {
    const { result } = renderStart(vi.fn(() => Promise.reject(new ProblemError({ status: 409, code: 'config.invalid', title: 'Students Camera missing' }))));
    act(() => result.current.start());
    await vi.waitFor(() => expect(result.current.state).toMatchObject({ kind: 'refused', problem: { code: 'config.invalid' } }));
  });

  it('maps recorder.busy to a named refusal until the locked view lands', async () => {
    const { result } = renderStart(vi.fn(() => Promise.reject(new ProblemError({ status: 409, code: 'recorder.busy', title: 'Already recording' }))));
    act(() => result.current.start());
    await vi.waitFor(() => expect(result.current.state).toMatchObject({ kind: 'refused', problem: { code: 'recorder.busy' } }));
  });

  it('maps a transport failure to failed, not refused', async () => {
    const { result } = renderStart(vi.fn(() => Promise.reject(new TransportError('startRecording'))));
    act(() => result.current.start());
    await vi.waitFor(() => expect(result.current.state.kind).toBe('failed'));
  });

  it('does not issue or queue a command while stale', () => {
    const startRecording = vi.fn(() => Promise.resolve({ resolveBySec: 10 }));
    useWsStore.setState({ stale: true });
    const { result } = renderStart(startRecording);
    act(() => result.current.start());
    expect(startRecording).not.toHaveBeenCalled();
    expect(result.current.state.kind).toBe('offline');
  });
});
