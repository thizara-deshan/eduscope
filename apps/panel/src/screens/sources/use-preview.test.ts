import { createElement, type ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EduscopeClient, PreviewChannel } from '@eduscope/api-client';
import type { PreviewClientMessage, PreviewServerMessage } from '@eduscope/shared';
import { ClientContext } from '../../client/client-provider.js';
import { useWsStore } from '../../store/ws-store.js';
import { usePreview } from './use-preview.js';

function fakeChannel() {
  const listeners = new Set<(message: PreviewServerMessage) => void>();
  const send = vi.fn<(message: PreviewClientMessage) => void>();
  const close = vi.fn();
  const channel: PreviewChannel = {
    send,
    close,
    messages$: {
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };
  return {
    channel, send, close,
    emit: (message: PreviewServerMessage) => {
      for (const listener of listeners) listener(message);
    },
  };
}

function renderPreview(channel: PreviewChannel, clientOverrides: Record<string, unknown> = {}) {
  const client = { openPreview: vi.fn(() => channel), ...clientOverrides } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(ClientContext.Provider, { value: client, children });
  return renderHook(() => usePreview('presentation'), { wrapper });
}

function offerFrom(send: ReturnType<typeof vi.fn>): Extract<PreviewClientMessage, { type: 'offer' }> {
  return send.mock.calls[0]![0] as Extract<PreviewClientMessage, { type: 'offer' }>;
}

describe('usePreview', () => {
  beforeEach(() => {
    useWsStore.getState().reset();
    useWsStore.setState({ recording: { state: 'recording' } as never, stale: false });
  });

  it('mints a fresh negotiationId for each lightbox open', () => {
    const first = fakeChannel();
    const second = fakeChannel();
    const firstView = renderPreview(first.channel);
    const firstId = offerFrom(first.send).negotiationId;
    firstView.unmount();
    const secondView = renderPreview(second.channel);
    expect(offerFrom(second.send).negotiationId).not.toBe(firstId);
    secondView.unmount();
  });

  it('opens a dedicated channel and sends exactly one offer', () => {
    const preview = fakeChannel();
    const view = renderPreview(preview.channel);
    expect(preview.send).toHaveBeenCalledTimes(1);
    expect(offerFrom(preview.send)).toMatchObject({ type: 'offer', roleId: 'presentation' });
    view.unmount();
  });

  it('moves negotiating to live on answer and paints mock frames through the narrow guard', () => {
    const preview = fakeChannel();
    const { result, unmount } = renderPreview(preview.channel);
    const negotiationId = offerFrom(preview.send).negotiationId;
    expect(result.current.state).toEqual({ kind: 'negotiating' });
    act(() => preview.emit({ type: 'answer', negotiationId, sdp: 'v=0' }));
    expect(result.current.state).toEqual({ kind: 'live', frame: '' });
    act(() => preview.emit({
      type: 'ice', negotiationId, candidate: 'data:image/svg+xml;base64,frame',
      sdpMid: 'mock-frame', sdpMLineIndex: null,
    }));
    expect(result.current.state).toEqual({ kind: 'live', frame: 'data:image/svg+xml;base64,frame' });
    unmount();
  });

  it.each(['source-offline', 'source-unbound', 'busy', 'internal'] as const)(
    'maps error{%s} to its named failed state',
    (code) => {
      const preview = fakeChannel();
      const { result, unmount } = renderPreview(preview.channel);
      const negotiationId = offerFrom(preview.send).negotiationId;
      act(() => preview.emit({ type: 'error', negotiationId, code, message: `message for ${code}` }));
      expect(result.current.state).toEqual({ kind: 'failed', code, message: `message for ${code}` });
      unmount();
    },
  );

  it('sends close and closes its channel on unmount', () => {
    const preview = fakeChannel();
    const view = renderPreview(preview.channel);
    const negotiationId = offerFrom(preview.send).negotiationId;
    view.unmount();
    expect(preview.send).toHaveBeenLastCalledWith({ type: 'close', negotiationId });
    expect(preview.close).toHaveBeenCalledTimes(1);
  });

  it('closes as disconnected when the observable panel WS becomes stale', () => {
    const preview = fakeChannel();
    const { result, unmount } = renderPreview(preview.channel);
    act(() => useWsStore.setState({ stale: true }));
    expect(result.current.state).toEqual({ kind: 'closed', reason: 'disconnected' });
    expect(preview.send.mock.calls.at(-1)?.[0]).toMatchObject({ type: 'close' });
    unmount();
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
    expect(result.current.state).toEqual({ kind: 'closed', reason: 'user' });
    expect(pauseRecording).not.toHaveBeenCalled();
    expect(resumeRecording).not.toHaveBeenCalled();
    expect(stopRecording).not.toHaveBeenCalled();
    expect(useWsStore.getState().recording).toBe(before);
    unmount();
  });
});
