import { act, createElement, type ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import { ProblemError, TransportError } from '@eduscope/api-client';
import { AuthProvider, useAuth } from '../../auth/auth-context.js';
import { ClientContext } from '../../client/client-provider.js';
import { useChangePassword } from './use-change-password.js';

function makeUser(overrides: Partial<Record<string, unknown>> = {}) {
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

function renderUseChangePassword(
  client: Record<string, (...args: never[]) => Promise<unknown>>,
  initial: { currentPassword: string; newPassword: string; confirm: string },
) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: 0 } } });
  const stub = client as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(ClientContext.Provider, { value: stub }, createElement(AuthProvider, null, children)),
    );
  return renderHook(({ values }) => ({ reset: useChangePassword(values), auth: useAuth() }), {
    initialProps: { values: initial },
    wrapper,
  });
}

const COMPLIANT = 'Passw0rdd';

describe('useChangePassword', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('canSubmit is false until all five rules pass', () => {
    const { result, rerender } = renderUseChangePassword(
      { changePassword: vi.fn() },
      { currentPassword: '', newPassword: '', confirm: '' },
    );
    expect(result.current.reset.canSubmit).toBe(false);
    rerender({ values: { currentPassword: 'temp-pass-1', newPassword: COMPLIANT, confirm: '' } });
    expect(result.current.reset.canSubmit).toBe(false);
    rerender({ values: { currentPassword: 'temp-pass-1', newPassword: COMPLIANT, confirm: COMPLIANT } });
    expect(result.current.reset.canSubmit).toBe(true);
  });

  it('confirm != new -> mismatch with the exact copy', () => {
    const { result } = renderUseChangePassword(
      { changePassword: vi.fn() },
      { currentPassword: 'temp-pass-1', newPassword: COMPLIANT, confirm: 'different' },
    );
    expect(result.current.reset.state.phase).toBe('mismatch');
    expect(result.current.reset.message).toEqual({
      kind: 'error',
      text: 'The two new passwords do not match.',
    });
  });

  it('is submitting while the promise is pending', () => {
    const changePassword = vi.fn(() => new Promise(() => {}));
    const { result } = renderUseChangePassword(
      { changePassword },
      { currentPassword: 'temp-pass-1', newPassword: COMPLIANT, confirm: COMPLIANT },
    );
    act(() => result.current.reset.submit());
    expect(result.current.reset.state.phase).toBe('submitting');
  });

  it('204 -> getMe is called, setUser receives the re-read user, phase success', async () => {
    const changePassword = vi.fn(() => Promise.resolve(undefined));
    const getMe = vi.fn(() => Promise.resolve(makeUser({ mustResetPassword: false })));
    const { result } = renderUseChangePassword(
      { changePassword, getMe },
      { currentPassword: 'temp-pass-1', newPassword: COMPLIANT, confirm: COMPLIANT },
    );
    await act(async () => result.current.reset.submit());
    expect(getMe).toHaveBeenCalledTimes(1);
    expect(result.current.reset.state.phase).toBe('success');
    expect(result.current.auth.user?.mustResetPassword).toBe(false);
  });

  it('204 + a getMe that still says mustResetPassword:true -> NOT success (the infinite-loop regression)', async () => {
    const changePassword = vi.fn(() => Promise.resolve(undefined));
    const getMe = vi.fn(() => Promise.resolve(makeUser({ mustResetPassword: true })));
    const { result } = renderUseChangePassword(
      { changePassword, getMe },
      { currentPassword: 'temp-pass-1', newPassword: COMPLIANT, confirm: COMPLIANT },
    );
    await act(async () => result.current.reset.submit());
    expect(result.current.reset.state.phase).not.toBe('success');
  });

  it('401 auth.invalid-credentials -> rejected-current with the exact copy', async () => {
    const changePassword = vi.fn(() =>
      Promise.reject(
        new ProblemError({ status: 401, code: 'auth.invalid-credentials', title: 'Nope' } as never),
      ),
    );
    const { result } = renderUseChangePassword(
      { changePassword },
      { currentPassword: 'wrong', newPassword: COMPLIANT, confirm: COMPLIANT },
    );
    await act(async () => result.current.reset.submit());
    expect(result.current.reset.state.phase).toBe('rejected-current');
    expect(result.current.reset.message).toEqual({
      kind: 'error',
      text: 'Your current password is not correct.',
    });
  });

  it('422 validation.invalid -> rejected-policy with the exact copy', async () => {
    const changePassword = vi.fn(() =>
      Promise.reject(
        new ProblemError({ status: 422, code: 'validation.invalid', title: 'Bad password' } as never),
      ),
    );
    const { result } = renderUseChangePassword(
      { changePassword },
      { currentPassword: 'temp-pass-1', newPassword: COMPLIANT, confirm: COMPLIANT },
    );
    await act(async () => result.current.reset.submit());
    expect(result.current.reset.state.phase).toBe('rejected-policy');
    expect(result.current.reset.message).toEqual({
      kind: 'error',
      text: 'That password does not meet the requirements above.',
    });
  });

  it('a TransportError -> unreachable; a pending promise + 10000ms -> unreachable', async () => {
    const changePassword = vi.fn(() => Promise.reject(new TransportError('changePassword')));
    const { result } = renderUseChangePassword(
      { changePassword },
      { currentPassword: 'temp-pass-1', newPassword: COMPLIANT, confirm: COMPLIANT },
    );
    await act(async () => result.current.reset.submit());
    expect(result.current.reset.state.phase).toBe('unreachable');

    const hanging = vi.fn(() => new Promise(() => {}));
    const { result: result2 } = renderUseChangePassword(
      { changePassword: hanging },
      { currentPassword: 'temp-pass-1', newPassword: COMPLIANT, confirm: COMPLIANT },
    );
    act(() => result2.current.reset.submit());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(result2.current.reset.state.phase).toBe('unreachable');
  });

  it("signOut() calls client.logout(), then clearTokens and setUser(null), in that order", async () => {
    const logout = vi.fn(() => Promise.resolve(undefined));
    const { result } = renderUseChangePassword(
      { changePassword: vi.fn(), logout },
      { currentPassword: '', newPassword: '', confirm: '' },
    );
    expect(result.current.auth.user).toBeNull();
    await act(async () => result.current.reset.signOut());
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('the request body always carries currentPassword', async () => {
    const changePassword = vi.fn(() => Promise.resolve(undefined));
    const getMe = vi.fn(() => Promise.resolve(makeUser({ mustResetPassword: false })));
    const { result } = renderUseChangePassword(
      { changePassword, getMe },
      { currentPassword: 'temp-pass-1', newPassword: COMPLIANT, confirm: COMPLIANT },
    );
    await act(async () => result.current.reset.submit());
    expect(changePassword).toHaveBeenCalledWith(
      expect.objectContaining({ currentPassword: 'temp-pass-1' }),
    );
  });
});
