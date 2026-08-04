import { Outlet, useLocation } from 'react-router';
import { KeyboardHost } from '../keyboard/keyboard-host.js';
import { OverlayHost, OverlayProvider } from '../overlays/overlay-host.js';
import { PanelHeader } from '../shell/panel-header.js';
import { RecordingChrome } from '../shell/recording-chrome.js';

/** No header before login (C-1: nothing is readable) and during a forced reset (C-3: 403). */
const NO_HEADER_PATHS = new Set(['/login', '/login/reset']);

/**
 * The layout route element. S-03 (panel shell, chrome & alert host — "panel,
 * all routes") lands HERE in Wave 1: header, recording frame + notch, the
 * alert/banner host and the WS connection indicator all go beside <Outlet/>,
 * inside the router, so they can use useLocation/useNavigate.
 */
export function PanelShell() {
  const location = useLocation();
  const showHeader = !NO_HEADER_PATHS.has(location.pathname);

  return (
    <OverlayProvider>
      {showHeader && <PanelHeader />}
      <RecordingChrome />
      <Outlet />
      <OverlayHost />
      <KeyboardHost />
    </OverlayProvider>
  );
}
