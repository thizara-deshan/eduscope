import { createElement, type ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import { ProblemError } from '@eduscope/api-client';
import type { User } from '@eduscope/shared';
import { AuthProvider } from '../auth/auth-context.js';
import { ClientContext } from '../client/client-provider.js';
import '../styles/tokens.css';
import { PanelHeader } from './panel-header.js';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    username: 'a.perera',
    displayName: 'A. Perera',
    role: 'lecturer',
    source: 'institute',
    mustResetPassword: false,
    disabled: false,
    lastLoginAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderHeader(getProvisioning: (...args: never[]) => Promise<unknown>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const stub = { getProvisioning } as unknown as EduscopeClient;
  const router = createMemoryRouter(
    [
      { path: '/', element: createElement(PanelHeader) },
      { path: '/login', element: createElement('div', { 'data-testid': 'login-screen' }) },
    ],
    { initialEntries: ['/'] },
  );
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(ClientContext.Provider, { value: stub }, createElement(AuthProvider, {
        initialUser: makeUser(),
        children,
      })),
    );
  render(createElement(RouterProvider, { router }), { wrapper });
  return router;
}

describe('PanelHeader', () => {
  it('shows the hall name once the query resolves, nothing before', async () => {
    let resolve!: (v: unknown) => void;
    const getProvisioning = vi.fn(() => new Promise((r) => { resolve = r; }));
    renderHeader(getProvisioning);
    expect(screen.queryByText('Hall A')).toBeNull();
    resolve({ hallDisplayName: 'Hall A' });
    await waitFor(() => expect(screen.getByText('Hall A')).toBeInTheDocument());
  });

  it('a 401 auth.session-revoked (takeover) from getProvisioning clears the user and lands on /login', async () => {
    const getProvisioning = vi.fn(() =>
      Promise.reject(
        new ProblemError({
          status: 401, code: 'auth.session-revoked', title: 'Revoked',
          meta: { reason: 'takeover' },
        } as never),
      ),
    );
    const router = renderHeader(getProvisioning);
    await waitFor(() => expect(screen.getByTestId('login-screen')).toBeInTheDocument());
    expect(router.state.location.state).toEqual({ reason: 'takeover' });
  });

  it('shows the signed-in user\'s displayName and a menu affordance', async () => {
    renderHeader(vi.fn(() => new Promise(() => {})));
    const trigger = screen.getByRole('button', { name: /A\. Perera/ });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
  });

  it("the clock renders time and date, and the time's computed font-size is >=19px", () => {
    renderHeader(vi.fn(() => new Promise(() => {})));
    const time = document.querySelector('.us-clock__time') as HTMLElement;
    const date = document.querySelector('.us-clock__date') as HTMLElement;
    expect(time.textContent).toMatch(/\d/);
    expect(date.textContent).toMatch(/[a-zA-Z]/);
    expect(getComputedStyle(time).fontSize).toBe('19px');
  });

  it("the header's computed height is 62px", () => {
    renderHeader(vi.fn(() => new Promise(() => {})));
    const header = document.querySelector('.us-header') as HTMLElement;
    expect(getComputedStyle(header).height).toBe('62px');
  });
});
