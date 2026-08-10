import { Outlet, useLocation } from 'react-router';
import { KeyboardHost } from '../keyboard/keyboard-host.js';
import { OverlayHost, OverlayProvider } from '../overlays/overlay-host.js';
import { OfflineMarker } from '../shell/offline-marker.js';
import { PanelHeader } from '../shell/panel-header.js';
import { RecordingChrome } from '../shell/recording-chrome.js';
import { StreamingWhilePaused } from '../shell/streaming-while-paused.js';

/**
 * No header, alerts or streaming-while-paused before login (C-1: nothing is
 * readable) and during a forced reset (C-3: every authenticated read except
 * `/auth/change-password` and `/auth/me` answers 403).
 */
const AUTH_ROUTE_PATHS = new Set(['/login', '/login/reset']);

/**
 * The layout route element. S-03 (panel shell, chrome & alert host — "panel,
 * all routes") lands HERE in Wave 1: header, recording frame + notch, the
 * alert/banner host and the WS connection indicator all go beside <Outlet/>,
 * inside the router, so they can use useLocation/useNavigate.
 */
export function PanelShell() {
  const location = useLocation();
  const showAuthenticatedChrome = !AUTH_ROUTE_PATHS.has(location.pathname);

  return (
    <OverlayProvider>
      {showAuthenticatedChrome && <PanelHeader />}
      <RecordingChrome />
      {showAuthenticatedChrome && <StreamingWhilePaused />}
      {showAuthenticatedChrome && <OfflineMarker />}
      <Outlet />
      <OverlayHost />
      <KeyboardHost />
    </OverlayProvider>
  );
}
