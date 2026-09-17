import { createElement, type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EduscopeClient, PreviewChannel, PreviewUpdate } from '@eduscope/api-client';
import { ClientContext } from '../../client/client-provider.js';
import { useWsStore } from '../../store/ws-store.js';
import { usePreview } from './use-preview.js';

function fakeChannel() {
  const listeners = new Set<(update: PreviewUpdate) => void>();
  const close = vi.fn();
  const channel: PreviewChannel = {
    close,
    updates$: {
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };
  return {
    channel,
    close,
    emit: (update: PreviewUpdate) => {
      for (const listener of listeners) listener(update);
    },
  };
}

function renderPreview(channel: PreviewChannel, clientOverrides: Record<string, unknown> = {}) {
  const openPreview = vi.fn(() => channel);
  const client = { openPreview, ...clientOverrides } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(ClientContext.Provider, { value: client, children });
  return { ...renderHook(() => usePreview('presentation'), { wrapper }), openPreview };
}

function bitmap(size: number) {
  return { width: size, height: 1, close: vi.fn() } as unknown as ImageBitmap;
}

describe('usePreview', () => {
  beforeEach(() => {
    useWsStore.getState().reset();
    useWsStore.setState({ recording: { state: 'recording' } as never, stale: false });
    vi.stubGlobal('createImageBitmap', vi.fn(async (blob: Blob) => bitmap(blob.size)));
  });

  it('opens a role-bound channel and starts in loading state', () => {
    const preview = fakeChannel();
    const view = renderPreview(preview.channel);
    expect(view.openPreview).toHaveBeenCalledWith('presentation');
    expect(view.result.current.state).toEqual({ kind: 'negotiating' });
    view.unmount();
  });

  it('closes a decoded frame when it is superseded or unmounted', async () => {
    const preview = fakeChannel();
    const { result, unmount } = renderPreview(preview.channel);
    const first = new Blob(['first'], { type: 'image/jpeg' });
    const second = new Blob(['second-frame'], { type: 'image/jpeg' });
    act(() => preview.emit({ kind: 'frame', blob: first, receivedAt: 1, stale: false }));
    await waitFor(() => expect(result.current.state.kind).toBe('live'));
    const firstBitmap = result.current.state.kind === 'live' ? result.current.state.frame as ImageBitmap : null;
    act(() => preview.emit({ kind: 'frame', blob: second, receivedAt: 2, stale: false }));
    await waitFor(() => expect(firstBitmap?.close).toHaveBeenCalledOnce());
    const secondBitmap = result.current.state.kind === 'live' ? result.current.state.frame as ImageBitmap : null;
    expect(secondBitmap?.width).toBe(12);
    unmount();
    expect(secondBitmap?.close).toHaveBeenCalledOnce();
  });

  it('retains the last good frame while stale and returns to live on recovery', async () => {
    const preview = fakeChannel();
    const { result, unmount } = renderPreview(preview.channel);
    act(() => preview.emit({
      kind: 'frame', blob: new Blob(['frame'], { type: 'image/jpeg' }), receivedAt: 1, stale: false,
    }));
    await waitFor(() => expect(result.current.state.kind).toBe('live'));
    const firstFrame = result.current.state.kind === 'live' ? result.current.state.frame : null;
    act(() => preview.emit({ kind: 'stale', since: 1 }));
    expect(result.current.state).toEqual({ kind: 'stale', frame: firstFrame });
    act(() => preview.emit({
      kind: 'frame', blob: new Blob(['recovered'], { type: 'image/jpeg' }), receivedAt: 4, stale: false,
    }));
    await waitFor(() => expect(result.current.state.kind === 'live' && result.current.state.frame !== firstFrame).toBe(true));
    unmount();
  });

  it('marks a retained frame stale when the source status goes offline', async () => {
    const preview = fakeChannel();
    const { result, unmount } = renderPreview(preview.channel);
    act(() => preview.emit({
      kind: 'frame', blob: new Blob(['frame'], { type: 'image/jpeg' }), receivedAt: 1, stale: false,
    }));
    await waitFor(() => expect(result.current.state.kind).toBe('live'));
    const firstFrame = result.current.state.kind === 'live' ? result.current.state.frame : null;
    act(() => useWsStore.setState({
      sources: { presentation: {
        roleId: 'presentation', state: 'offline', detail: 'unplugged',
        since: '2026-09-08T04:00:00.000Z', inputId: null,
      } },
    }));
    expect(result.current.state).toEqual({ kind: 'stale', frame: firstFrame });
    act(() => preview.emit({
      kind: 'frame', blob: new Blob(['recovered'], { type: 'image/jpeg' }), receivedAt: 4, stale: false,
    }));
    await waitFor(() => expect(result.current.state.kind === 'live' && result.current.state.frame !== firstFrame).toBe(true));
    unmount();
  });

  it('shows an error before any usable frame but retains a live frame on a transient error', async () => {
    const preview = fakeChannel();
    const { result, unmount } = renderPreview(preview.channel);
    act(() => preview.emit({ kind: 'error', code: 'internal', message: 'Preview unavailable.' }));
    expect(result.current.state).toEqual({
      kind: 'failed', code: 'internal', message: 'Preview unavailable.',
    });
    act(() => preview.emit({
      kind: 'frame', blob: new Blob(['frame'], { type: 'image/jpeg' }), receivedAt: 1, stale: false,
    }));
    await waitFor(() => expect(result.current.state.kind).toBe('live'));
    const frame = result.current.state.kind === 'live' ? result.current.state.frame : null;
    act(() => preview.emit({ kind: 'error', code: 'source-offline', message: 'offline' }));
    expect(result.current.state).toEqual({ kind: 'live', frame });
    unmount();
  });

  it('closes exactly once on unmount and when the user closes explicitly', () => {
    const first = fakeChannel();
    const firstView = renderPreview(first.channel);
    firstView.unmount();
    expect(first.close).toHaveBeenCalledTimes(1);

    const second = fakeChannel();
    const secondView = renderPreview(second.channel);
    act(() => secondView.result.current.close());
    expect(secondView.result.current.state).toEqual({ kind: 'closed', reason: 'user' });
    secondView.unmount();
    expect(second.close).toHaveBeenCalledTimes(1);
  });

  it('closing preview never issues a recording command or mutates recording.state', () => {
    const preview = fakeChannel();
    const pauseRecording = vi.fn();
    const resumeRecording = vi.fn();
    const stopRecording = vi.fn();
    const { result, unmount } = renderPreview(preview.channel, {
      pauseRecording, resumeRecording, stopRecording,
    });
    const before = useWsStore.getState().recording;
    act(() => result.current.close());
    expect(pauseRecording).not.toHaveBeenCalled();
    expect(resumeRecording).not.toHaveBeenCalled();
    expect(stopRecording).not.toHaveBeenCalled();
    expect(useWsStore.getState().recording).toBe(before);
    unmount();
  });
});
