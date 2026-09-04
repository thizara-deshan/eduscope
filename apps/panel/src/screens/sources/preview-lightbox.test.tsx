import { createElement, type ReactNode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EduscopeClient, PreviewChannel, PreviewUpdate } from '@eduscope/api-client';
import { ClientContext } from '../../client/client-provider.js';
import { OverlayProvider } from '../../overlays/overlay-host.js';
import { useWsStore } from '../../store/ws-store.js';
import '../../styles/tokens.css';
import { PreviewLightbox } from './preview-lightbox.js';

function renderLightbox() {
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
  const client = { openPreview: vi.fn(() => channel) } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    ClientContext.Provider,
    { value: client },
    createElement(OverlayProvider, null, children),
  );
  const view = render(<PreviewLightbox roleId="presentation" label="Presentation" />, { wrapper });
  return {
    ...view, close,
    emit: (update: PreviewUpdate) => {
      for (const listener of listeners) listener(update);
    },
  };
}

describe('PreviewLightbox', () => {
  beforeEach(() => {
    useWsStore.getState().reset();
    useWsStore.setState({ stale: false });
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn((blob: Blob) => `blob:preview-${blob.size}`),
      revokeObjectURL: vi.fn(),
    });
  });

  it('holds the preview frame shape with a negotiating skeleton', () => {
    renderLightbox();
    expect(screen.getByRole('dialog', { name: 'Presentation preview' })).toBeInTheDocument();
    expect(screen.getByTestId('preview-skeleton')).toBeInTheDocument();
  });

  it('renders the LIVE chip and paints the latest mock frame', () => {
    const preview = renderLightbox();
    act(() => preview.emit({
      kind: 'frame', blob: new Blob(['frame'], { type: 'image/jpeg' }), receivedAt: 1, stale: false,
    }));
    expect(screen.getByText('LIVE')).toBeInTheDocument();
    expect(screen.getByTestId('preview-frame')).toHaveAttribute('src', 'blob:preview-5');
  });

  it.each([
    ['source-offline', 'This camera is offline.'],
    ['source-unbound', 'This source is not connected.'],
    ['internal', 'The preview could not be opened.'],
  ] as const)('renders the server-provided copy for %s', (code, message) => {
    const preview = renderLightbox();
    act(() => preview.emit({ kind: 'error', code, message }));
    expect(screen.getByText(message)).toBeInTheDocument();
  });

  it('retains the last frame and labels it stale', () => {
    const preview = renderLightbox();
    act(() => preview.emit({
      kind: 'frame', blob: new Blob(['frame'], { type: 'image/jpeg' }), receivedAt: 1, stale: false,
    }));
    act(() => preview.emit({ kind: 'stale', since: 1 }));
    expect(screen.getByText('STALE')).toBeInTheDocument();
    expect(screen.getByTestId('preview-frame')).toHaveAttribute('src', 'blob:preview-5');
  });

  it('has a labelled close target at least 44px square and closes the poller', () => {
    const preview = renderLightbox();
    const close = screen.getByRole('button', { name: 'Close preview' });
    expect(getComputedStyle(close).width).toBe('44px');
    expect(getComputedStyle(close).height).toBe('44px');
    fireEvent.click(close);
    expect(preview.close).toHaveBeenCalledTimes(1);
  });
});
