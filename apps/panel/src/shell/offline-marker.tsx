import { useEffect, useRef } from 'react';
import { useIsStale } from '../store/selectors.js';
import './shell.css';

/**
 * U-2 (state-machines §5.5): after `T-WS-STALE` disconnected, dim live
 * regions and show a "reconnecting" marker — the recording frame is KEPT
 * (Task 14's `RecordingChrome` reads `recording.state` only, never `stale`,
 * so it already does the right thing without this file touching it).
 *
 * The dimming hook is a class toggled on the nearest `.us-panel`, written
 * imperatively (same technique `KeyboardHost` uses for `--osk-h`) so this
 * component's own re-renders never ripple into a store subscription other
 * screens would have to guard against.
 */
export function OfflineMarker(): JSX.Element {
  const stale = useIsStale();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const panel = ref.current?.closest('.us-panel');
    if (!(panel instanceof HTMLElement)) return undefined;
    panel.classList.toggle('us-shell--stale', stale);
    return () => panel.classList.remove('us-shell--stale');
  }, [stale]);

  return (
    <div ref={ref}>
      {stale && (
        <div className="us-offline" data-testid="offline-marker" role="status">
          Reconnecting…
        </div>
      )}
    </div>
  );
}
