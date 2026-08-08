import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SourcesStatusPayload } from '@eduscope/shared';
import { useWsStore } from '../../store/ws-store.js';
import { SourceTile } from './source-tile.js';

const status = (state: SourcesStatusPayload['state']): SourcesStatusPayload => ({
  roleId: 'presentation', state, detail: null,
  since: '2026-08-05T10:00:00Z', inputId: null,
});

describe('SourceTile', () => {
  beforeEach(() => {
    useWsStore.getState().reset();
    useWsStore.setState({ stale: false });
  });

  it('renders an online tile as Live and opens it', () => {
    const onOpen = vi.fn();
    render(<SourceTile roleId="presentation" displayLabel="Presentation" status={status('online')} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: 'Live' }));
    expect(onOpen).toHaveBeenCalledWith('presentation');
    expect(screen.getByTestId('source-tile')).toHaveAttribute('data-state', 'online');
  });

  it('renders a degraded tile with the reconnecting state and keeps preview available', () => {
    const onOpen = vi.fn();
    render(<SourceTile roleId="presentation" displayLabel="Presentation" status={status('degraded')} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: 'reconnecting…' }));
    expect(onOpen).toHaveBeenCalledWith('presentation');
  });

  it('makes an offline tile aria-disabled with the health word as its accessible name', () => {
    render(<SourceTile roleId="presentation" displayLabel="Presentation" status={status('offline')} onOpen={vi.fn()} />);
    const tile = screen.getByRole('button', { name: 'No signal' });
    expect(tile).toBeDisabled();
    expect(tile).toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByRole('button', { name: /expand/i })).toBeNull();
  });

  it('renders undefined and explicit unknown status as checking, never as a prior healthy value', () => {
    const first = render(<SourceTile roleId="presentation" displayLabel="Presentation" status={undefined} onOpen={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'checking…' })).toBeDisabled();
    first.rerender(<SourceTile roleId="presentation" displayLabel="Presentation" status={status('online')} onOpen={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Live' })).toBeEnabled();
    first.rerender(<SourceTile roleId="presentation" displayLabel="Presentation" status={status('unknown')} onOpen={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'checking…' })).toBeDisabled();
  });

  it('does not render an unbound role', () => {
    const view = render(<SourceTile roleId="presentation" displayLabel="Presentation" status={status('unbound')} onOpen={vi.fn()} />);
    expect(view.container).toBeEmptyDOMElement();
  });

  it('dims the tile and disables preview while the event stream is stale', () => {
    const onOpen = vi.fn();
    useWsStore.setState({ stale: true });
    render(<SourceTile roleId="presentation" displayLabel="Presentation" status={status('online')} onOpen={onOpen} />);
    const tile = screen.getByRole('button', { name: 'Live' });
    expect(tile).toBeDisabled();
    expect(tile).toHaveAttribute('data-stale', 'true');
    fireEvent.click(tile);
    expect(onOpen).not.toHaveBeenCalled();
  });
});
