import { createElement, type ReactNode } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import { AuthProvider } from '../auth/auth-context.js';
import { ClientContext } from '../client/client-provider.js';
import '../styles/tokens.css';
import { UserMenu } from './user-menu.js';

function renderMenu(logout: (...args: never[]) => Promise<unknown> = vi.fn(() => Promise.resolve(undefined))) {
  const stub = { logout } as unknown as EduscopeClient;
  const router = createMemoryRouter(
    [
      {
        path: '/library',
        element: createElement('div', null, createElement(UserMenu, { displayName: 'A. Perera' })),
      },
      { path: '/login', element: createElement('div', { 'data-testid': 'login-screen' }) },
      { path: '/login/reset', element: createElement('div', { 'data-testid': 'reset-screen' }) },
    ],
    { initialEntries: ['/library'] },
  );
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(ClientContext.Provider, { value: stub }, createElement(AuthProvider, { children }));
  render(createElement(RouterProvider, { router }), { wrapper });
  return router;
}

describe('UserMenu', () => {
  it('opens on tap with exactly two menuitems, each >=56px; does not open on hover', () => {
    renderMenu();
    const trigger = screen.getByRole('button', { name: /A\. Perera/ });
    fireEvent.mouseOver(trigger);
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(trigger);
    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(getComputedStyle(item).minHeight).toBe('56px');
    }
  });

  it("Change password navigates to /login/reset carrying state.from equal to the current pathname", async () => {
    const router = renderMenu();
    await userEvent.click(screen.getByRole('button', { name: /A\. Perera/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Change password' }));
    expect(screen.getByTestId('reset-screen')).toBeInTheDocument();
    expect(router.state.location.state).toEqual({ from: '/library' });
  });

  it('Sign out calls logout(), clears the user, and lands on /login with reason: logout', async () => {
    const logout = vi.fn(() => Promise.resolve(undefined));
    const router = renderMenu(logout);
    await userEvent.click(screen.getByRole('button', { name: /A\. Perera/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect(logout).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(screen.getByTestId('login-screen')).toBeInTheDocument());
    expect(router.state.location.state).toEqual({ reason: 'logout' });
  });

  it('Escape and an outside tap both close the menu', () => {
    renderMenu();
    const trigger = screen.getByRole('button', { name: /A\. Perera/ });

    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
