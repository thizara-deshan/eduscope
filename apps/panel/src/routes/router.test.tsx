import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import { AuthProvider } from '../auth/auth-context.js';
import { ClientContext } from '../client/client-provider.js';
import { ADVANCED_NAV_ITEMS } from '../screens/advanced/advanced-nav.js';
import { ROUTES, routeObjects } from './router.js';

// PanelHeader (S-03) reads useClient() on every route except the two auth
// routes, so every render here needs a stub client — getProvisioning hangs
// deliberately: these tests assert on the SCREEN, not on the header's
// eventually-resolved hall name.
function renderAt(path: string, role: 'lecturer' | 'admin' = 'lecturer') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const stub = {
    getProvisioning: vi.fn(() => new Promise(() => {})),
    getMe: vi.fn(() => new Promise(() => {})),
    listChannels: vi.fn(() => new Promise(() => {})),
    listLayoutPresets: vi.fn(() => new Promise(() => {})),
    listSourceRoles: vi.fn(() => new Promise(() => {})),
    getSourcesStatus: vi.fn(() => new Promise(() => {})),
    listStreamTargets: vi.fn(() => new Promise(() => {})),
  } as unknown as EduscopeClient;
  const router = createMemoryRouter(routeObjects, { initialEntries: [path] });
  return render(
    <QueryClientProvider client={queryClient}>
      <ClientContext.Provider value={stub}>
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
        </AuthProvider>
      </ClientContext.Provider>
    </QueryClientProvider>,
  );
}

describe('panel router (screen-inventory §1.1)', () => {
  it('declares the flat nav-map routes — Advanced (S-25..S-36) is its own nested route', () => {
    expect(ROUTES.map((r) => r.path)).toEqual([
      '/login', '/login/reset', '/', '/library', '/library/:recordingId',
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
  ])('renders %s as screen %s', (path, screenId) => {
    renderAt(path);
    expect(screen.getByTestId('screen').dataset.screen).toBe(screenId);
  });

  it('renders the real Advanced shell (S-25) at /advanced, not a placeholder', () => {
    renderAt('/advanced/local-capture');
    expect(screen.getByTestId('advanced-shell')).toBeInTheDocument();
    expect(screen.getByTestId('screen').dataset.screen).toBe('S-26');
  });

  it('renders an admin route for an admin', () => {
    renderAt('/advanced/users', 'admin');
    expect(screen.getByTestId('screen').dataset.screen).toBe('S-32');
  });

  it('U-6: a lecturer hitting an admin-only Advanced route lands in their own shell, never a 403', () => {
    renderAt('/advanced/network', 'lecturer');
    expect(screen.getByTestId('advanced-shell')).toBeInTheDocument();
    expect(screen.getByTestId('screen').dataset.screen).toBe('S-26');
    expect(screen.queryByText(/403/)).toBeNull();
  });

  it('/advanced redirects to the role default category', () => {
    renderAt('/advanced', 'admin');
    expect(screen.getByTestId('screen').dataset.screen).toBe('S-28');
    cleanup();
    renderAt('/advanced', 'lecturer');
    expect(screen.getByTestId('screen').dataset.screen).toBe('S-26');
  });

  it('reaches all 16 nav-map screens across the flat and nested route trees', () => {
    const reached = [...ROUTES.map((r) => r.screen), 'S-25', ...ADVANCED_NAV_ITEMS.map((i) => i.screen)];
    expect(new Set(reached).size).toBe(16);
    expect(reached).toEqual(expect.arrayContaining([
      'S-01', 'S-02', 'S-04', 'S-21', 'S-22', 'S-25',
      'S-26', 'S-27', 'S-28', 'S-29', 'S-30', 'S-31', 'S-32', 'S-34', 'S-35', 'S-36',
    ]));
  });

  it('mounts every route inside ONE layout route — S-03 is (panel, all routes)', () => {
    expect(routeObjects).toHaveLength(1);
    // ROUTES (flat) + the /advanced parent + catch-all
    expect(routeObjects[0]!.children).toHaveLength(ROUTES.length + 2);
  });

  it('gives the shell an overlay host on every route', () => {
    renderAt('/library');
    expect(screen.getByTestId('overlay-host')).toBeTruthy();
    // vitest.config.ts sets globals: false, so RTL's afterEach(cleanup) auto-
    // registration never fires — and cleanup only runs between tests anyway,
    // not between two render() calls in the same test. Explicit unmount here.
    cleanup();
    renderAt('/advanced/local-capture');
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
