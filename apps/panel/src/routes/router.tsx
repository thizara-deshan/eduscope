import { createBrowserRouter, type RouteObject } from 'react-router';
import type { UserRole } from '@eduscope/shared';
import { RequireRole } from '../auth/require-role.js';
import { LoginScreen } from '../screens/login/login-screen.js';
import { ResetScreen } from '../screens/reset/reset-screen.js';
import { DashboardScreen } from '../screens/dashboard/dashboard-screen.js';
import { AdvancedShell } from '../screens/advanced/advanced-shell.js';
import { AdvancedIndex } from '../screens/advanced/advanced-index.js';
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

/** screen-inventory §1.1. Overlays are UI-local state and appear nowhere here. Advanced (S-25..S-36) is its own nested route below, not a flat entry. */
export const ROUTES: readonly RouteSpec[] = [
  { path: '/login', screen: 'S-01', title: 'Login', gate: 'public' },
  { path: '/login/reset', screen: 'S-02', title: 'Set a new password' },
  { path: '/', screen: 'S-04', title: 'Dashboard' },
  { path: '/library', screen: 'S-21', title: 'Recordings' },
  { path: '/library/:recordingId', screen: 'S-22', title: 'Recording detail' },
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

/** Advanced children reachable by both roles — no per-route gate beyond the shell's own `RequireRole`. */
interface AdvancedChildSpec {
  readonly path: string;
  readonly screen: string;
  readonly title: string;
}

const ADVANCED_SHARED_CHILDREN: readonly AdvancedChildSpec[] = [
  { path: 'local-capture', screen: 'S-26', title: 'Local Capture Layout' },
  { path: 'streaming', screen: 'S-27', title: 'Streaming Configuration' },
];

/** Admin-only Advanced children: a role mismatch lands back in the lecturer's own shell (U-6), not `/`. */
const ADVANCED_ADMIN_CHILDREN: readonly AdvancedChildSpec[] = [
  { path: 'network', screen: 'S-28', title: 'Network' },
  { path: 'encoder', screen: 'S-29', title: 'Encoder' },
  { path: 'storage', screen: 'S-30', title: 'Local Storage' },
  { path: 'firmware', screen: 'S-31', title: 'Firmware' },
  { path: 'users', screen: 'S-32', title: 'User Management' },
  { path: 'logs', screen: 'S-34', title: 'System Logs' },
  { path: 'uploads', screen: 'S-35', title: 'Upload Queue' },
  { path: 'device', screen: 'S-36', title: 'Device & Identity' },
];

const advancedChildRoutes: RouteObject[] = [
  { index: true, element: <AdvancedIndex /> },
  ...ADVANCED_SHARED_CHILDREN.map(({ path, screen, title }) => ({
    path,
    element: <ScreenPlaceholder id={screen} title={title} />,
  })),
  ...ADVANCED_ADMIN_CHILDREN.map(({ path, screen, title }) => ({
    path,
    element: (
      // RequireRole's `role` prop is a UserRole, not an ARIA role attribute.
      // eslint-disable-next-line jsx-a11y/aria-role
      <RequireRole role="admin" redirectTo="/advanced/local-capture">
        <ScreenPlaceholder id={screen} title={title} />
      </RequireRole>
    ),
  })),
];

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
      {
        path: '/advanced',
        element: (
          <RequireRole>
            <AdvancedShell />
          </RequireRole>
        ),
        children: advancedChildRoutes,
      },
      // No address bar to mistype, but a bad programmatic navigate must not
      // leave a blank panel with no way back.
      { path: '*', element: <ScreenPlaceholder id="not-found" title="Screen not found" /> },
    ],
  },
];

export const createRouter = () => createBrowserRouter(routeObjects);
