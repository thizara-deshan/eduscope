import { cleanup, render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AuthProvider } from '../auth/auth-context.js';
import { ROUTES, routeObjects } from './router.js';

function renderAt(path: string, role: 'lecturer' | 'admin' = 'lecturer') {
  const router = createMemoryRouter(routeObjects, { initialEntries: [path] });
  return render(
    <AuthProvider
      initialUser={{
        id: '01JBQ8ZK3T7WBM5N2Q4XPRVC9D',
        username: 'a.perera',
        displayName: 'A. Perera',
        role,
        source: 'local',
        mustResetPassword: false,
        disabled: false,
        lastLoginAt: null,
        createdAt: '2026-01-01T00:00:00+00:00',
      }}
    >
      <RouterProvider router={router} />
    </AuthProvider>,
  );
}

describe('panel router (screen-inventory §1.1)', () => {
  it('declares exactly the 16 nav-map routes', () => {
    expect(ROUTES.map((r) => r.path)).toEqual([
      '/login', '/login/reset', '/', '/library', '/library/:recordingId',
      '/advanced', '/advanced/local-capture', '/advanced/streaming',
      '/advanced/network', '/advanced/encoder', '/advanced/storage',
      '/advanced/firmware', '/advanced/users', '/advanced/logs',
      '/advanced/uploads', '/advanced/device',
    ]);
  });

  it('gives no overlay a route (SI-D-2)', () => {
    const overlayIds = ['S-10', 'S-12', 'S-14', 'S-15', 'S-18', 'S-19', 'S-20', 'S-23', 'S-24', 'S-33'];
    for (const id of overlayIds) {
      expect(ROUTES.some((r) => r.screen === id), `${id} must not be a route`).toBe(false);
    }
  });

  it.each([
    ['/', 'S-04'],
    ['/library', 'S-21'],
    ['/advanced', 'S-25'],
    ['/advanced/local-capture', 'S-26'],
  ])('renders %s as screen %s', (path, screenId) => {
    renderAt(path);
    expect(screen.getByTestId('screen').dataset.screen).toBe(screenId);
  });

  it('renders an admin route for an admin', () => {
    renderAt('/advanced/users', 'admin');
    expect(screen.getByTestId('screen').dataset.screen).toBe('S-32');
  });

  it('mounts every route inside ONE layout route — S-03 is (panel, all routes)', () => {
    expect(routeObjects).toHaveLength(1);
    expect(routeObjects[0]!.children).toHaveLength(ROUTES.length + 1); // + catch-all
  });

  it('gives the shell an overlay host on every route', () => {
    renderAt('/library');
    expect(screen.getByTestId('overlay-host')).toBeTruthy();
    // vitest.config.ts sets globals: false, so RTL's afterEach(cleanup) auto-
    // registration never fires — and cleanup only runs between tests anyway,
    // not between two render() calls in the same test. Explicit unmount here.
    cleanup();
    renderAt('/advanced');
    expect(screen.getByTestId('overlay-host')).toBeTruthy();
  });

  it('catches an unknown path instead of rendering blank', () => {
    renderAt('/nope/not/a/route');
    expect(screen.getByTestId('screen').dataset.screen).toBe('not-found');
  });

  it('renders an error card instead of a white screen when a route throws', () => {
    // A component that throws during React's render pass — not an IIFE
    // invoked while building this array, which would throw immediately at
    // test-setup time, before createMemoryRouter/render ever runs, and so
    // could never reach the errorElement boundary.
    function Boom(): never {
      throw new Error('kaboom');
    }
    // Built without spreading routeObjects[0] (a RouteObject union member):
    // spreading it and overriding `children` conflicts with
    // exactOptionalPropertyTypes's narrowing of the index/non-index variants.
    const boom: typeof routeObjects = [
      {
        element: routeObjects[0]!.element,
        errorElement: routeObjects[0]!.errorElement,
        children: [
          {
            path: '/',
            element: <Boom />,
          },
        ],
      },
    ];
    const router = createMemoryRouter(boom, { initialEntries: ['/'] });
    render(<RouterProvider router={router} />);
    expect(screen.getByTestId('route-error')).toBeTruthy();
  });
});
