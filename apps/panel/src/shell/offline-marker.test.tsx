import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, beforeEach } from 'vitest';
import { useWsStore } from '../store/ws-store.js';
import { RecordingChrome } from './recording-chrome.js';
import { OfflineMarker } from './offline-marker.js';

function renderInPanel(children: React.ReactNode) {
  return render(<div className="us-panel" data-testid="us-panel">{children}</div>);
}

describe('OfflineMarker', () => {
  beforeEach(() => {
    useWsStore.getState().reset();
  });

  it("phase: 'open' -> no marker", () => {
    useWsStore.getState().setConnection({ phase: 'open', attempt: 0, since: '2026-01-01T00:00:00.000Z' });
    renderInPanel(<OfflineMarker />);
    expect(screen.queryByTestId('offline-marker')).toBeNull();
  });

  it("phase: 'reconnecting', not yet stale -> no marker (U-2 fires at T-WS-STALE)", () => {
    useWsStore.getState().setConnection({
      phase: 'reconnecting', attempt: 1, since: '2026-01-01T00:00:00.000Z',
    });
    renderInPanel(<OfflineMarker />);
    expect(screen.queryByTestId('offline-marker')).toBeNull();
  });

  it('stale: true -> marker present, with accessible text naming reconnection', () => {
    useWsStore.getState().setConnection({ phase: 'stale', attempt: 3, since: '2026-01-01T00:00:00.000Z' });
    renderInPanel(<OfflineMarker />);
    const marker = screen.getByTestId('offline-marker');
    expect(marker).toHaveAttribute('role', 'status');
    expect(marker.textContent).toMatch(/reconnect/i);
  });

  it('stale: true + recording -> the recording frame is still rendered', () => {
    const s = useWsStore.getState();
    s.ingest({ event: 'recording.state', at: '2026-01-01T00:00:00.000Z', seq: 0, payload: { state: 'recording' } } as never);
    s.setConnection({ phase: 'stale', attempt: 1, since: '2026-01-01T00:00:00.000Z' });
    renderInPanel(
      <>
        <RecordingChrome />
        <OfflineMarker />
      </>,
    );
    expect(screen.getByTestId('recording-frame')).toBeInTheDocument();
    expect(screen.getByTestId('offline-marker')).toBeInTheDocument();
  });

  it('stale: true -> the shell root carries the dimming class; removed on recovery', () => {
    act(() => {
      useWsStore.getState().setConnection({ phase: 'stale', attempt: 1, since: '2026-01-01T00:00:00.000Z' });
    });
    renderInPanel(<OfflineMarker />);
    expect(screen.getByTestId('us-panel').className).toContain('us-shell--stale');

    act(() => {
      useWsStore.getState().setConnection({ phase: 'open', attempt: 0, since: '2026-01-01T00:00:05.000Z' });
    });
    expect(screen.getByTestId('us-panel').className).not.toContain('us-shell--stale');
  });

  it('has no outbound command queue (state-machines §5.5 — commands are never queued and replayed)', () => {
    expect(Object.keys(useWsStore.getState()).join(',')).not.toMatch(/queue/i);
  });
});
