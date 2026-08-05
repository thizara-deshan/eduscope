import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OverlayProvider } from '../../overlays/overlay-host.js';
import { useWsStore } from '../../store/ws-store.js';
import { CaptureSourcesRow } from './capture-sources-row.js';

const source = (roleId: string, state: string) => ({
  roleId, state, detail: null, inputId: null, since: '2026-08-05T10:00:00.000Z',
});

function renderSources() {
  useWsStore.getState().reset();
  useWsStore.setState({ sources: {
    presentation: source('presentation', 'online'),
    'lecturer-cam': source('lecturer-cam', 'offline'),
    'students-cam': source('students-cam', 'unknown'),
  } as never });
  return render(<OverlayProvider><CaptureSourcesRow dense={false} /></OverlayProvider>);
}

describe('CaptureSourcesRow', () => {
  it('keeps the fixed PC, CAM 1, CAM 2 order under stress', () => {
    renderSources();
    const tiles = within(screen.getByTestId('capture-sources')).getAllByTestId('capture-source-tile');
    expect(tiles.map((tile) => tile.getAttribute('data-role')))
      .toEqual(['presentation', 'lecturer-cam', 'students-cam']);
  });

  it('keeps healthy tiles wired and makes offline or unknown tiles inaccessible to taps', () => {
    renderSources();
    const live = screen.getByRole('button', { name: 'Live' });
    const offline = screen.getByRole('button', { name: 'No signal' });
    const unknown = screen.getByRole('button', { name: 'Checking' });
    expect(live).not.toHaveAttribute('aria-disabled', 'true');
    expect(offline).toHaveAttribute('aria-disabled', 'true');
    expect(unknown).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(live);
    fireEvent.click(offline);
    expect(offline).toBeDisabled();
  });

  it('freezes healthy preview taps while the lecture is stopping', () => {
    renderSources();
    const live = screen.getByRole('button', { name: 'Live' });
    expect(live).toBeEnabled();
    act(() => useWsStore.setState({ recording: { state: 'stopping' } as never }));
    expect(live).toHaveAttribute('aria-disabled', 'true');
    expect(live).toBeDisabled();
  });
});
