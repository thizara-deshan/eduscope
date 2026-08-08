import { createElement, type ReactNode } from 'react';
import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import type { User } from '@eduscope/shared';
import { AuthProvider } from '../../auth/auth-context.js';
import { ClientContext } from '../../client/client-provider.js';
import { useWsStore } from '../../store/ws-store.js';
import { routeObjects } from '../../routes/router.js';
import { AdvancedShell } from './advanced-shell.js';
import '../../styles/tokens.css';

function makeUser(role: 'lecturer' | 'admin'): User {
  return {
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', username: 'a.perera', displayName: 'A. Perera',
    role, source: 'institute', mustResetPassword: false, disabled: false,
    lastLoginAt: null, createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function renderShellDirect(user: User | null, client: Partial<EduscopeClient> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const stub = { getMe: vi.fn(() => new Promise(() => {})), ...client } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider,
    { client: queryClient },
    createElement(ClientContext.Provider, { value: stub },
      createElement(AuthProvider, { initialUser: user, children: createElement(MemoryRouter, null, children) })),
  );
  return render(<AdvancedShell />, { wrapper });
}

function renderAt(path: string, role: 'lecturer' | 'admin' = 'lecturer') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const stub = {
    getProvisioning: vi.fn(() => new Promise(() => {})),
    getMe: vi.fn(() => new Promise(() => {})),
  } as unknown as EduscopeClient;
  const router = createMemoryRouter(routeObjects, { initialEntries: [path] });
  return render(
    <QueryClientProvider client={queryClient}>
      <ClientContext.Provider value={stub}>
        <AuthProvider initialUser={makeUser(role)}>
          <RouterProvider router={router} />
        </AuthProvider>
      </ClientContext.Provider>
    </QueryClientProvider>,
  );
}

describe('S-25 Advanced shell', () => {
  it('admin: title "System Administration", nav label "Categories", 10 items', () => {
    renderShellDirect(makeUser('admin'));
    expect(screen.getByText('System Administration')).toBeInTheDocument();
    expect(screen.getByText('Categories')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Network Settings|Encoder Settings|Local Storage|Firmware Update|User Management|System Logs|Local Capture Layout|Streaming Configuration|Upload Queue|Device & Identity/ })).toHaveLength(10);
  });

  it('lecturer: title "Advanced", nav label "Outputs", 2 items', () => {
    renderShellDirect(makeUser('lecturer'));
    expect(screen.getByText('Advanced')).toBeInTheDocument();
    expect(screen.getByText('Outputs')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Local Capture Layout/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Streaming Configuration/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Network Settings/ })).toBeNull();
  });

  it('category selected: aria-current="page" marks the active nav item', () => {
    renderAt('/advanced/streaming', 'admin');
    expect(screen.getByRole('button', { name: /Streaming Configuration/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: /Network Settings/ })).not.toHaveAttribute('aria-current');
  });

  it('back to dashboard: navigates to /', () => {
    renderAt('/advanced/local-capture', 'lecturer');
    act(() => { screen.getByRole('button', { name: /Back to Dashboard/ }).click(); });
    expect(screen.getByTestId('screen').dataset.screen).toBe('S-04');
  });

  it('recording-live restrictions: permitted nav stays visible and recording chrome persists', () => {
    useWsStore.getState().reset();
    useWsStore.setState({ recording: { state: 'recording' } as never });
    renderAt('/advanced/local-capture', 'lecturer');
    expect(screen.getByRole('button', { name: /Local Capture Layout/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Streaming Configuration/ })).toBeInTheDocument();
    expect(document.querySelector('.us-recframe')).not.toBeNull();
  });

  it('U-1: shows a cold shell skeleton before role resolves', () => {
    renderShellDirect(null);
    expect(screen.getByTestId('advanced-shell-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('advanced-shell')).toBeNull();
  });

  it('U-2: the reconnecting marker never hides Advanced nav', () => {
    useWsStore.getState().reset();
    useWsStore.setState({ stale: true });
    renderShellDirect(makeUser('lecturer'));
    expect(screen.getByRole('button', { name: /Local Capture Layout/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Streaming Configuration/ })).toBeInTheDocument();
    useWsStore.getState().reset();
  });

  it('U-6: a lecturer deep-link to /advanced/network lands in the role-scoped shell at /advanced/local-capture', () => {
    renderAt('/advanced/network', 'lecturer');
    expect(screen.getByTestId('advanced-shell')).toBeInTheDocument();
    expect(screen.getByTestId('screen').dataset.screen).toBe('S-26');
    expect(screen.queryByRole('button', { name: /Network Settings/ })).toBeNull();
  });
});
