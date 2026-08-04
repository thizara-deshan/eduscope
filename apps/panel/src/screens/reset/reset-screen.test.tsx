import { createElement, type ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import { ProblemError } from '@eduscope/api-client';
import type { User } from '@eduscope/shared';
import { AuthProvider } from '../../auth/auth-context.js';
import { ClientContext } from '../../client/client-provider.js';
import { ResetScreen } from './reset-screen.js';

const COMPLIANT = 'Passw0rdd';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    username: 'n.silva',
    displayName: 'N. Silva',
    role: 'lecturer',
    source: 'institute',
    mustResetPassword: false,
    disabled: false,
    lastLoginAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderScreen(options: {
  mustResetPassword: boolean;
  client: Record<string, (...args: never[]) => Promise<unknown>>;
  entry?: { pathname: string; state?: unknown };
}) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: 0 } } });
  const stub = options.client as unknown as EduscopeClient;
  const router = createMemoryRouter(
    [
      { path: '/login/reset', element: createElement(ResetScreen) },
      { path: '/login', element: createElement('div', { 'data-testid': 'login-screen' }) },
      { path: '/', element: createElement('div', { 'data-testid': 'dashboard' }) },
      { path: '/library', element: createElement('div', { 'data-testid': 'library' }) },
    ],
    { initialEntries: [options.entry ?? { pathname: '/login/reset' }] },
  );
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(
        ClientContext.Provider,
        { value: stub },
        createElement(AuthProvider, {
          initialUser: makeUser({ mustResetPassword: options.mustResetPassword }),
          children,
        }),
      ),
    );
  render(createElement(RouterProvider, { router }), { wrapper });
  return router;
}

async function fillCompliant() {
  await userEvent.type(screen.getByLabelText('Current password'), 'temp-pass-1');
  await userEvent.type(screen.getByLabelText('New password'), COMPLIANT);
  await userEvent.type(screen.getByLabelText('Confirm new password'), COMPLIANT);
}

describe('ResetScreen', () => {
  it('forced — Sign out present, reason text present, no Cancel', () => {
    renderScreen({ mustResetPassword: true, client: { changePassword: vi.fn() } });
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.getByText(/Your account was created by an administrator/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('voluntary — Cancel present, no reason text, no Sign out', () => {
    renderScreen({ mustResetPassword: false, client: { changePassword: vi.fn() } });
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.queryByText(/Your account was created by an administrator/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
  });

  it('validating — checklist rows flip live; submit disabled until all five are met', async () => {
    renderScreen({ mustResetPassword: true, client: { changePassword: vi.fn() } });
    expect(screen.getByRole('button', { name: 'Set password' })).toBeDisabled();
    await fillCompliant();
    expect(screen.getByRole('button', { name: 'Set password' })).not.toBeDisabled();
  });

  it('mismatch — match-confirm row unmet and the message names it', async () => {
    renderScreen({ mustResetPassword: true, client: { changePassword: vi.fn() } });
    await userEvent.type(screen.getByLabelText('Current password'), 'temp-pass-1');
    await userEvent.type(screen.getByLabelText('New password'), COMPLIANT);
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'different');
    expect(screen.getByTestId('auth-message').textContent).toBe(
      'The two new passwords do not match.',
    );
    expect(screen.getByRole('button', { name: 'Set password' })).toBeDisabled();
  });

  it('submitting — pending affordance; all three fields disabled', async () => {
    const changePassword = vi.fn(() => new Promise(() => {}));
    renderScreen({ mustResetPassword: true, client: { changePassword } });
    await fillCompliant();
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }));
    expect(screen.getByLabelText('Current password')).toBeDisabled();
    expect(screen.getByLabelText('New password')).toBeDisabled();
    expect(screen.getByLabelText('Confirm new password')).toBeDisabled();
  });

  it('rejected (current) — copy shown, Current password cleared and refocused', async () => {
    const changePassword = vi.fn(() =>
      Promise.reject(
        new ProblemError({ status: 401, code: 'auth.invalid-credentials', title: 'Nope' } as never),
      ),
    );
    renderScreen({ mustResetPassword: true, client: { changePassword } });
    await fillCompliant();
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }));
    await waitFor(() =>
      expect(screen.getByTestId('auth-message').textContent).toBe(
        'Your current password is not correct.',
      ),
    );
    expect(screen.getByLabelText('Current password')).toHaveValue('');
    expect(screen.getByLabelText('Current password')).toHaveFocus();
  });

  it('rejected (policy) — copy shown; the checklist is still rendered', async () => {
    const changePassword = vi.fn(() =>
      Promise.reject(
        new ProblemError({ status: 422, code: 'validation.invalid', title: 'Bad' } as never),
      ),
    );
    renderScreen({ mustResetPassword: true, client: { changePassword } });
    await fillCompliant();
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }));
    await waitFor(() =>
      expect(screen.getByTestId('auth-message').textContent).toBe(
        'That password does not meet the requirements above.',
      ),
    );
    expect(screen.getByText('PASSWORD MUST')).toBeInTheDocument();
  });

  it('success forced -> router at /', async () => {
    const changePassword = vi.fn(() => Promise.resolve(undefined));
    const getMe = vi.fn(() => Promise.resolve(makeUser({ mustResetPassword: false })));
    renderScreen({ mustResetPassword: true, client: { changePassword, getMe } });
    await fillCompliant();
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }));
    await waitFor(() => expect(screen.getByTestId('dashboard')).toBeInTheDocument());
  });

  it('success voluntary -> router at state.from', async () => {
    const changePassword = vi.fn(() => Promise.resolve(undefined));
    const getMe = vi.fn(() => Promise.resolve(makeUser({ mustResetPassword: false })));
    renderScreen({
      mustResetPassword: false,
      client: { changePassword, getMe },
      entry: { pathname: '/login/reset', state: { from: '/library' } },
    });
    await fillCompliant();
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }));
    await waitFor(() => expect(screen.getByTestId('library')).toBeInTheDocument());
  });

  it('Sign out -> logout() called, router at /login, location.state.reason === logout', async () => {
    const logout = vi.fn(() => Promise.resolve(undefined));
    const router = renderScreen({
      mustResetPassword: true,
      client: { changePassword: vi.fn(), logout },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(screen.getByTestId('login-screen')).toBeInTheDocument());
    expect(logout).toHaveBeenCalledTimes(1);
    expect(router.state.location.state).toEqual({ reason: 'logout' });
  });

  it('mode freeze: navigates to / even if mustResetPassword flips to false mid-flight (W1-D-4)', async () => {
    const changePassword = vi.fn(() => Promise.resolve(undefined));
    const getMe = vi.fn(() => Promise.resolve(makeUser({ mustResetPassword: false })));
    renderScreen({
      mustResetPassword: true,
      client: { changePassword, getMe },
      entry: { pathname: '/login/reset', state: { from: '/library' } },
    });
    await fillCompliant();
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }));
    // getMe resolves mustResetPassword:false (auth context flips), but `mode`
    // was frozen 'forced' at mount, so navigation still targets '/', not
    // state.from — proving the freeze, not a live derivation.
    await waitFor(() => expect(screen.getByTestId('dashboard')).toBeInTheDocument());
  });

  it('the reveal button exists on New password and on neither other field', () => {
    renderScreen({ mustResetPassword: true, client: { changePassword: vi.fn() } });
    expect(screen.getAllByRole('button', { name: /show password/i })).toHaveLength(1);
  });

  it('all three inputs are autoComplete="off"; Current password is focused on mount', () => {
    renderScreen({ mustResetPassword: true, client: { changePassword: vi.fn() } });
    expect(screen.getByLabelText('Current password')).toHaveAttribute('autocomplete', 'off');
    expect(screen.getByLabelText('New password')).toHaveAttribute('autocomplete', 'off');
    expect(screen.getByLabelText('Confirm new password')).toHaveAttribute('autocomplete', 'off');
    expect(screen.getByLabelText('Current password')).toHaveFocus();
  });
});
