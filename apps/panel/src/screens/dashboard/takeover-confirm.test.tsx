import { createElement, type ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import { ProblemError } from '@eduscope/api-client';
import type { User } from '@eduscope/shared';
import { AuthProvider } from '../../auth/auth-context.js';
import { ClientContext } from '../../client/client-provider.js';
import { useWsStore } from '../../store/ws-store.js';
import { TakeoverConfirm } from './takeover-confirm.js';

const admin: User = {
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAB', username: 'admin', displayName: 'Admin',
  role: 'admin', source: 'local', mustResetPassword: false, disabled: false,
  lastLoginAt: null, createdAt: '2026-01-01T00:00:00.000Z',
};
const session = (overrides: Record<string, unknown> = {}) => ({
  state: 'recording', startReason: 'initial', sessionId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  title: 'CS2043 — Lecture 7', ownerUserId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  ownerDisplayName: 'A. Perera', startedAt: '2026-08-05T10:00:00Z',
  recordedDurationMs: 5_000, segmentIndex: 1, segmentCount: 1, pauseCount: 0,
  takeoverBy: null, takeoverAt: null, takeoverByDisplayName: null,
  errorCode: null, errorMessage: null, ...overrides,
});

function renderConfirm(takeoverRecording: () => Promise<unknown>) {
  useWsStore.getState().reset();
  useWsStore.setState({ recording: session() as never });
  const client = { takeoverRecording } as unknown as EduscopeClient;
  const onClose = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    ClientContext.Provider,
    { value: client },
    createElement(AuthProvider, { initialUser: admin, children }),
  );
  return { ...render(<TakeoverConfirm onClose={onClose} />, { wrapper }), onClose };
}

describe('TakeoverConfirm', () => {
  it('renders the fixed confirm copy and buttons', () => {
    renderConfirm(vi.fn(() => Promise.resolve({ resolveBySec: 10 })));
    expect(screen.getByText('Take over this recording?')).toBeInTheDocument();
    expect(screen.getByText(/A\. Perera is recording CS2043 — Lecture 7/i)).toBeInTheDocument();
    expect(screen.getByText(/recorded against your name/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Take over' })).toBeEnabled();
  });

  it('enters pending after the 202 and disables both buttons', () => {
    renderConfirm(vi.fn(() => Promise.resolve({ resolveBySec: 10 })));
    fireEvent.click(screen.getByRole('button', { name: 'Take over' }));
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Taking over…' })).toBeDisabled();
  });

  it.each([
    ['not-authorized', 403, 'You are no longer an administrator on this device.'],
    ['conflict', 409, 'That lecture has already ended.'],
  ])('renders the %s refusal and replaces the destructive action with Close', async (code, status, copy) => {
    renderConfirm(vi.fn(() => Promise.reject(new ProblemError({ status, code: code as 'not-authorized' | 'conflict', title: 'Refused' }))));
    fireEvent.click(screen.getByRole('button', { name: 'Take over' }));
    await screen.findByText(copy);
    expect(screen.queryByRole('button', { name: 'Take over' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled();
  });

  it('reaches done and closes when recording.state names this admin as takeoverBy', async () => {
    const view = renderConfirm(vi.fn(() => Promise.resolve({ resolveBySec: 10 })));
    fireEvent.click(screen.getByRole('button', { name: 'Take over' }));
    act(() => useWsStore.setState({ recording: session({ takeoverBy: admin.id }) as never }));
    await waitFor(() => expect(view.onClose).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
