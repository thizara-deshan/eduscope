import { createBrowserRouter, type RouteObject } from 'react-router';
import type { UserRole } from '@eduscope/shared';
import { RequireRole } from '../auth/require-role.js';
import { LoginScreen } from '../screens/login/login-screen.js';
import { ResetScreen } from '../screens/reset/reset-screen.js';
import { DashboardScreen } from '../screens/dashboard/dashboard-screen.js';
import { PanelShell } from './panel-shell.js';
import { RouteError } from './route-error.js';
import { ScreenPlaceholder } from './screens.js';

/** Screens with a real implementation. Everything else is still a placeholder. */
const SCREEN_ELEMENTS: Partial<Record<string, () => JSX.Element>> = {
  'S-01': () => <LoginScreen />,
  'S-02': () => <ResetScreen />,
  'S-04': () => <DashboardScreen />,
};

interface RouteSpec {
  readonly path: string;
  readonly screen: string;
  readonly title: string;
  /** Omitted = any authenticated role. `public` = no gate at all. */
  readonly gate?: UserRole | 'public';
}

/** screen-inventory §1.1. Overlays are UI-local state and appear nowhere here. */
export const ROUTES: readonly RouteSpec[] = [
  { path: '/login', screen: 'S-01', title: 'Login', gate: 'public' },
  { path: '/login/reset', screen: 'S-02', title: 'Set a new password' },
  { path: '/', screen: 'S-04', title: 'Dashboard' },
  { path: '/library', screen: 'S-21', title: 'Recordings' },
  { path: '/library/:recordingId', screen: 'S-22', title: 'Recording detail' },
  { path: '/advanced', screen: 'S-25', title: 'Advanced' },
  { path: '/advanced/local-capture', screen: 'S-26', title: 'Local Capture Layout' },
  { path: '/advanced/streaming', screen: 'S-27', title: 'Streaming Configuration' },
  { path: '/advanced/network', screen: 'S-28', title: 'Network', gate: 'admin' },
  { path: '/advanced/encoder', screen: 'S-29', title: 'Encoder', gate: 'admin' },
  { path: '/advanced/storage', screen: 'S-30', title: 'Local Storage', gate: 'admin' },
  { path: '/advanced/firmware', screen: 'S-31', title: 'Firmware', gate: 'admin' },
  { path: '/advanced/users', screen: 'S-32', title: 'User Management', gate: 'admin' },
  { path: '/advanced/logs', screen: 'S-34', title: 'System Logs', gate: 'admin' },
  { path: '/advanced/uploads', screen: 'S-35', title: 'Upload Queue', gate: 'admin' },
  { path: '/advanced/device', screen: 'S-36', title: 'Device & Identity', gate: 'admin' },
];

const screenRoutes: RouteObject[] = ROUTES.map(({ path, screen, title, gate }) => {
  const Real = SCREEN_ELEMENTS[screen];
  const element = Real ? <Real /> : <ScreenPlaceholder id={screen} title={title} />;
  return {
    path,
    element:
      gate === 'public' ? (
        element
      ) : (
        <RequireRole {...(gate ? { role: gate } : {})}>{element}</RequireRole>
      ),
  };
});

/**
 * ONE layout route wrapping every screen. The shell must be inside the router,
 * not above it, or S-03's chrome cannot read the current location.
 */
export const routeObjects: RouteObject[] = [
  {
    element: <PanelShell />,
    errorElement: <RouteError />,
    children: [
      ...screenRoutes,
      // No address bar to mistype, but a bad programmatic navigate must not
      // leave a blank panel with no way back.
      { path: '*', element: <ScreenPlaceholder id="not-found" title="Screen not found" /> },
    ],
  },
];

export const createRouter = () => createBrowserRouter(routeObjects);
