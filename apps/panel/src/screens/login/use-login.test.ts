import { act, createElement, type ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import { ProblemError, TransportError } from '@eduscope/api-client';
import { AuthProvider, useAuth } from '../../auth/auth-context.js';
import { ClientContext } from '../../client/client-provider.js';
import { getTokens, clearTokens } from '../../auth/token-store.js';
import { useLogin } from './use-login.js';

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

function renderUseLogin(login: (...args: never[]) => Promise<unknown>, initial = { username: '', password: '' }) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: 0 } } });
  const client = { login } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(ClientContext.Provider, { value: client }, createElement(AuthProvider, null, children)),
    );
  return renderHook(({ credentials }) => ({ login: useLogin(credentials), auth: useAuth() }), {
    initialProps: { credentials: initial },
    wrapper,
  });
}

describe('useLogin', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    clearTokens();
  });

  it('canSubmit is false with either field blank, true with both filled', () => {
    const { result, rerender } = renderUseLogin(vi.fn(), { username: '', password: '' });
    expect(result.current.login.canSubmit).toBe(false);
    rerender({ credentials: { username: 'a.perera', password: '' } });
    expect(result.current.login.canSubmit).toBe(false);
    rerender({ credentials: { username: 'a.perera', password: 'correct-horse' } });
    expect(result.current.login.canSubmit).toBe(true);
  });

  it('is submitting while the promise is pending, and canSubmit is false', () => {
    const login = vi.fn(() => new Promise(() => {}));
    const { result } = renderUseLogin(login, { username: 'a.perera', password: 'x' });
    act(() => result.current.login.submit());
    expect(result.current.login.state.phase).toBe('submitting');
    expect(result.current.login.canSubmit).toBe(false);
  });

  it('401 auth.invalid-credentials -> rejected with the exact copy', async () => {
    const login = vi.fn(() =>
      Promise.reject(
        new ProblemError({ status: 401, code: 'auth.invalid-credentials', title: 'Nope' } as never),
      ),
    );
    const { result } = renderUseLogin(login, { username: 'a.perera', password: 'wrong' });
    act(() => result.current.login.submit());
    await vi.waitFor(() => expect(result.current.login.state.phase).toBe('rejected'));
    expect(result.current.login.message).toEqual({
      kind: 'error',
      text: 'That username and password do not match. Try again.',
    });
  });

  it('401 auth.account-disabled -> disabled with the exact copy and kind warning', async () => {
    const login = vi.fn(() =>
      Promise.reject(
        new ProblemError({ status: 401, code: 'auth.account-disabled', title: 'Disabled' } as never),
      ),
    );
    const { result } = renderUseLogin(login, { username: 'r.fonseka', password: 'x' });
    act(() => result.current.login.submit());
    await vi.waitFor(() => expect(result.current.login.state.phase).toBe('disabled'));
    expect(result.current.login.message).toEqual({
      kind: 'warning',
      text: 'This account is not active — ask your administrator.',
    });
  });

  it('a TransportError -> unreachable with the exact copy and kind info', async () => {
    const login = vi.fn(() => Promise.reject(new TransportError('login')));
    const { result } = renderUseLogin(login, { username: 'a.perera', password: 'x' });
    act(() => result.current.login.submit());
    await vi.waitFor(() => expect(result.current.login.state.phase).toBe('unreachable'));
    expect(result.current.login.message).toEqual({
      kind: 'info',
      text: 'The recording panel is starting up. Trying again…',
    });
  });

  it('a pending promise + advancing 10000ms -> unreachable (U-4: no indefinite spinner)', async () => {
    const login = vi.fn(() => new Promise(() => {}));
    const { result } = renderUseLogin(login, { username: 'a.perera', password: 'x' });
    act(() => result.current.login.submit());
    expect(result.current.login.state.phase).toBe('submitting');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(result.current.login.state.phase).toBe('unreachable');
  });

  it('unreachable auto-retries at 500ms, then 1000ms, then a success on retry 2 lands in success', async () => {
    const login = vi
      .fn<(...args: never[]) => Promise<unknown>>()
      .mockRejectedValueOnce(new TransportError('login'))
      .mockRejectedValueOnce(new TransportError('login'))
      .mockResolvedValueOnce({ user: makeUser(), tokens: { accessToken: 'a', refreshToken: 'r', expiresInSec: 900 }, mustResetPassword: false });
    const { result } = renderUseLogin(login, { username: 'a.perera', password: 'correct-horse' });
    act(() => result.current.login.submit());
    await vi.waitFor(() => expect(result.current.login.state.phase).toBe('unreachable'));
    expect(result.current.login.state).toMatchObject({ phase: 'unreachable', attempt: 1 });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    await vi.waitFor(() => expect(login).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(result.current.login.state).toMatchObject({ phase: 'unreachable', attempt: 2 }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    await vi.waitFor(() => expect(login).toHaveBeenCalledTimes(3));
    await vi.waitFor(() => expect(result.current.login.state.phase).toBe('success'));
  });

  it('200 with mustResetPassword:true -> must-reset, and setUser was called with the response user', async () => {
    const user = makeUser({ mustResetPassword: true, username: 'n.silva' });
    const login = vi.fn(() =>
      Promise.resolve({
        user,
        tokens: { accessToken: 'a', refreshToken: 'r', expiresInSec: 900 },
        mustResetPassword: true,
      }),
    );
    const { result } = renderUseLogin(login, { username: 'n.silva', password: 'temp-pass-1' });
    act(() => result.current.login.submit());
    await vi.waitFor(() => expect(result.current.login.state.phase).toBe('must-reset'));
    expect(result.current.auth.user).toEqual(user);
  });

  it('200 with mustResetPassword:false -> success, setTokens called with res.tokens', async () => {
    const tokens = { accessToken: 'a-token', refreshToken: 'r-token', expiresInSec: 900 };
    const login = vi.fn(() => Promise.resolve({ user: makeUser(), tokens, mustResetPassword: false }));
    const { result } = renderUseLogin(login, { username: 'a.perera', password: 'correct-horse' });
    act(() => result.current.login.submit());
    await vi.waitFor(() => expect(result.current.login.state.phase).toBe('success'));
    expect(getTokens()).toEqual(tokens);
  });

  it('unmounting mid-flight fires no timer callbacks afterwards', async () => {
    const login = vi.fn(() => Promise.reject(new TransportError('login')));
    const { result, unmount } = renderUseLogin(login, { username: 'a.perera', password: 'x' });
    act(() => result.current.login.submit());
    await vi.waitFor(() => expect(result.current.login.state.phase).toBe('unreachable'));
    unmount();
    const callsBefore = login.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(login.mock.calls.length).toBe(callsBefore);
  });
});
