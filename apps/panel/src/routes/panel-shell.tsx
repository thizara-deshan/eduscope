import { Outlet } from 'react-router';
import { KeyboardHost } from '../keyboard/keyboard-host.js';
import { OverlayHost, OverlayProvider } from '../overlays/overlay-host.js';

/**
 * The layout route element. S-03 (panel shell, chrome & alert host — "panel,
 * all routes") lands HERE in Wave 1: header, recording frame + notch, the
 * alert/banner host and the WS connection indicator all go beside <Outlet/>,
 * inside the router, so they can use useLocation/useNavigate.
 */
export function PanelShell() {
  return (
    <OverlayProvider>
      {/* Wave 1: <PanelHeader/> and the recording frame mount here. */}
      <Outlet />
      <OverlayHost />
      <KeyboardHost />
    </OverlayProvider>
  );
}
