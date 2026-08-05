import { createElement, type ReactNode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EduscopeClient, PreviewChannel } from '@eduscope/api-client';
import type { PreviewClientMessage, PreviewServerMessage } from '@eduscope/shared';
import { ClientContext } from '../../client/client-provider.js';
import { OverlayProvider } from '../../overlays/overlay-host.js';
import { useWsStore } from '../../store/ws-store.js';
import '../../styles/tokens.css';
import { PreviewLightbox } from './preview-lightbox.js';

function renderLightbox() {
  const listeners = new Set<(message: PreviewServerMessage) => void>();
  const send = vi.fn<(message: PreviewClientMessage) => void>();
  const channel: PreviewChannel = {
    send,
    close: vi.fn(),
    messages$: {
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };
  const client = { openPreview: vi.fn(() => channel) } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    ClientContext.Provider,
    { value: client },
    createElement(OverlayProvider, null, children),
  );
  const view = render(<PreviewLightbox roleId="presentation" label="Presentation" />, { wrapper });
  const offer = send.mock.calls[0]![0] as Extract<PreviewClientMessage, { type: 'offer' }>;
  return {
    ...view, send, offer,
    emit: (message: PreviewServerMessage) => {
      for (const listener of listeners) listener(message);
    },
  };
}

describe('PreviewLightbox', () => {
  beforeEach(() => {
    useWsStore.getState().reset();
    useWsStore.setState({ stale: false });
  });

  it('holds the preview frame shape with a negotiating skeleton', () => {
    renderLightbox();
    expect(screen.getByRole('dialog', { name: 'Presentation preview' })).toBeInTheDocument();
    expect(screen.getByTestId('preview-skeleton')).toBeInTheDocument();
  });

  it('renders the LIVE chip and paints the latest mock frame', () => {
    const preview = renderLightbox();
    act(() => preview.emit({ type: 'answer', negotiationId: preview.offer.negotiationId, sdp: 'v=0' }));
    expect(screen.getByText('LIVE')).toBeInTheDocument();
    act(() => preview.emit({
      type: 'ice', negotiationId: preview.offer.negotiationId,
      candidate: 'data:image/svg+xml;base64,frame', sdpMid: 'mock-frame', sdpMLineIndex: null,
    }));
    expect(screen.getByTestId('preview-frame')).toHaveAttribute('src', 'data:image/svg+xml;base64,frame');
  });

  it.each([
    ['source-offline', 'This camera is offline.'],
    ['source-unbound', 'This source is not connected.'],
    ['busy', 'Another preview is already open.'],
    ['internal', 'The preview could not be opened.'],
  ] as const)('renders the server-provided copy for %s', (code, message) => {
    const preview = renderLightbox();
    act(() => preview.emit({ type: 'error', negotiationId: preview.offer.negotiationId, code, message }));
    expect(screen.getByText(message)).toBeInTheDocument();
  });

  it('replaces a live frame with the unilateral source-offline reason', () => {
    const preview = renderLightbox();
    act(() => preview.emit({ type: 'answer', negotiationId: preview.offer.negotiationId, sdp: 'v=0' }));
    act(() => preview.emit({
      type: 'error', negotiationId: preview.offer.negotiationId,
      code: 'source-offline', message: 'The source went offline during preview.',
    }));
    expect(screen.getByText('The source went offline during preview.')).toBeInTheDocument();
    expect(screen.queryByText('LIVE')).toBeNull();
  });

  it('states the approved Wave 2 reason when the panel connection becomes stale', () => {
    renderLightbox();
    act(() => useWsStore.setState({ stale: true }));
    expect(screen.getByText('The preview disconnected.')).toBeInTheDocument();
  });

  it('has a labelled close target at least 44px square and sends close', () => {
    const preview = renderLightbox();
    const close = screen.getByRole('button', { name: 'Close preview' });
    expect(getComputedStyle(close).width).toBe('44px');
    expect(getComputedStyle(close).height).toBe('44px');
    fireEvent.click(close);
    expect(preview.send.mock.calls.at(-1)?.[0]).toMatchObject({ type: 'close' });
  });
});
