import { createElement, type ReactNode } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import { ProblemError, TransportError } from '@eduscope/api-client';
import { AuthProvider } from '../../auth/auth-context.js';
import { TAKEOVER_REVOKED_SENTENCE } from '../../auth/session.js';
import { ClientContext } from '../../client/client-provider.js';
import { LoginScreen } from './login-screen.js';

function makeUser(overrides: Partial<Record<string, unknown>> = {}) {
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

function renderScreen(
  login: (...args: never[]) => Promise<unknown>,
  entry: { pathname: string; state?: unknown } = { pathname: '/login' },
) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: 0 } } });
  const client = { login } as unknown as EduscopeClient;
  const router = createMemoryRouter(
    [
      {
        path: '/login',
        element: createElement(LoginScreen),
      },
      { path: '/login/reset', element: createElement('div', { 'data-testid': 'reset-screen' }) },
      { path: '/', element: createElement('div', { 'data-testid': 'dashboard' }) },
      { path: '/library', element: createElement('div', { 'data-testid': 'library' }) },
    ],
    { initialEntries: [entry] },
  );
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(ClientContext.Provider, { value: client }, createElement(AuthProvider, null, children)),
    );
  render(createElement(RouterProvider, { router }), { wrapper });
  return router;
}

describe('LoginScreen', () => {
  it('empty — both fields blank, submit disabled, the message slot present and empty', () => {
    renderScreen(vi.fn());
    expect(screen.getByRole('button', { name: 'Log In' })).toBeDisabled();
    expect(screen.getByTestId('auth-message').textContent).toBe('');
  });

  it('submitting — pending affordance on submit; both fields disabled', async () => {
    const login = vi.fn(() => new Promise(() => {}));
    renderScreen(login);
    await userEvent.type(screen.getByLabelText('Username'), 'a.perera');
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse');
    await userEvent.click(screen.getByRole('button', { name: 'Log In' }));
    expect(screen.getByLabelText('Username')).toBeDisabled();
    expect(screen.getByLabelText('Password')).toBeDisabled();
  });

  it('rejected — copy shown; username kept; password cleared; focus on password', async () => {
    const login = vi.fn(() =>
      Promise.reject(
        new ProblemError({ status: 401, code: 'auth.invalid-credentials', title: 'Nope' } as never),
      ),
    );
    renderScreen(login);
    await userEvent.type(screen.getByLabelText('Username'), 'a.perera');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Log In' }));
    await waitFor(() =>
      expect(screen.getByTestId('auth-message').textContent).toBe(
        'That username and password do not match. Try again.',
      ),
    );
    expect(screen.getByLabelText('Username')).toHaveValue('a.perera');
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(screen.getByLabelText('Password')).toHaveFocus();
  });

  it('disabled account — warning copy, not error', async () => {
    const login = vi.fn(() =>
      Promise.reject(
        new ProblemError({ status: 401, code: 'auth.account-disabled', title: 'Disabled' } as never),
      ),
    );
    renderScreen(login);
    await userEvent.type(screen.getByLabelText('Username'), 'r.fonseka');
    await userEvent.type(screen.getByLabelText('Password'), 'Correct-horse-9');
    await userEvent.click(screen.getByRole('button', { name: 'Log In' }));
    await waitFor(() => {
      const slot = screen.getByTestId('auth-message');
      expect(slot.textContent).toBe('This account is not active — ask your administrator.');
      expect(slot.className).toContain('us-authmsg--warning');
    });
  });

  it('must-reset — the router is at /login/reset', async () => {
    const login = vi.fn(() =>
      Promise.resolve({
        user: makeUser({ mustResetPassword: true, username: 'n.silva' }),
        tokens: { accessToken: 'a', refreshToken: 'r', expiresInSec: 900 },
        mustResetPassword: true,
      }),
    );
    renderScreen(login);
    await userEvent.type(screen.getByLabelText('Username'), 'n.silva');
    await userEvent.type(screen.getByLabelText('Password'), 'temp-pass-1');
    await userEvent.click(screen.getByRole('button', { name: 'Log In' }));
    await waitFor(() => expect(screen.getByTestId('reset-screen')).toBeInTheDocument());
  });

  it('backend unreachable — info copy; submit stays disabled between attempts', async () => {
    const login = vi.fn(() => Promise.reject(new TransportError('login')));
    renderScreen(login);
    await userEvent.type(screen.getByLabelText('Username'), 'a.perera');
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse');
    await userEvent.click(screen.getByRole('button', { name: 'Log In' }));
    await waitFor(() =>
      expect(screen.getByTestId('auth-message').textContent).toBe(
        'The recording panel is starting up. Trying again…',
      ),
    );
    expect(screen.getByRole('button', { name: 'Log In' })).toBeDisabled();
  });

  it.each([
    ['expired', 'Your session ended after a period of inactivity. Sign in again.'],
    ['takeover', `${TAKEOVER_REVOKED_SENTENCE} Sign in again to continue.`],
    ['admin', 'An administrator ended your session. Sign in again.'],
  ])('session expired · %s renders the reason copy', (reason, text) => {
    renderScreen(vi.fn(), { pathname: '/login', state: { reason } });
    expect(screen.getByTestId('auth-message').textContent).toBe(text);
  });

  it('session expired · logout renders no message', () => {
    renderScreen(vi.fn(), { pathname: '/login', state: { reason: 'logout' } });
    expect(screen.getByTestId('auth-message').textContent).toBe('');
  });

  it('success — router lands on state.from when present, / when absent', async () => {
    const tokens = { accessToken: 'a', refreshToken: 'r', expiresInSec: 900 };
    const login = vi.fn(() => Promise.resolve({ user: makeUser(), tokens, mustResetPassword: false }));
    renderScreen(login, { pathname: '/login', state: { from: '/library' } });
    await userEvent.type(screen.getByLabelText('Username'), 'a.perera');
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse');
    await userEvent.click(screen.getByRole('button', { name: 'Log In' }));
    await waitFor(() => expect(screen.getByTestId('library')).toBeInTheDocument());
  });

  it('success with no state.from lands on /', async () => {
    const tokens = { accessToken: 'a', refreshToken: 'r', expiresInSec: 900 };
    const login = vi.fn(() => Promise.resolve({ user: makeUser(), tokens, mustResetPassword: false }));
    renderScreen(login);
    await userEvent.type(screen.getByLabelText('Username'), 'a.perera');
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse');
    await userEvent.click(screen.getByRole('button', { name: 'Log In' }));
    await waitFor(() => expect(screen.getByTestId('dashboard')).toBeInTheDocument());
  });

  it('username is focused on mount and the keyboard would open (data-osk present)', () => {
    renderScreen(vi.fn());
    expect(screen.getByLabelText('Username')).toHaveFocus();
    expect(screen.getByLabelText('Username')).toHaveAttribute('data-osk', 'default');
  });

  it('both inputs are autoComplete="off"', () => {
    renderScreen(vi.fn());
    expect(screen.getByLabelText('Username')).toHaveAttribute('autocomplete', 'off');
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'off');
  });

  it('the arrival reason clears on the first keystroke', async () => {
    renderScreen(vi.fn(), { pathname: '/login', state: { reason: 'expired' } });
    expect(screen.getByTestId('auth-message').textContent).not.toBe('');
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'a' } });
    expect(screen.getByTestId('auth-message').textContent).toBe('');
  });
});
