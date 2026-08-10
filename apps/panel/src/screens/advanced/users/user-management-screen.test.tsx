import { createElement, type ReactNode } from 'react';
import { act } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import { ProblemError } from '@eduscope/api-client';
import type { User } from '@eduscope/shared';
import { AuthProvider } from '../../../auth/auth-context.js';
import { ClientContext } from '../../../client/client-provider.js';
import { OverlayHost, OverlayProvider } from '../../../overlays/overlay-host.js';
import { useWsStore } from '../../../store/ws-store.js';
import { UserManagementScreen } from './user-management-screen.js';

const admin = (overrides: Partial<User> = {}): User => ({
  id: 'ADMIN1', username: 'admin', displayName: 'Device Administrator', role: 'admin', source: 'local',
  mustResetPassword: false, disabled: false, lastLoginAt: '2026-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

const perera = (overrides: Partial<User> = {}): User => ({
  id: 'L1', username: 'a.perera', displayName: 'A. Perera', role: 'lecturer', source: 'institute',
  mustResetPassword: false, disabled: false, lastLoginAt: '2026-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

const silva = (overrides: Partial<User> = {}): User => ({
  id: 'L2', username: 'n.silva', displayName: 'N. Silva', role: 'lecturer', source: 'institute',
  mustResetPassword: true, disabled: false, lastLoginAt: null, createdAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

function build(methods: Partial<EduscopeClient> = {}, meUser: User = admin()) {
  useWsStore.getState().reset();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const stub = {
    listUsers: () => Promise.resolve({ items: [admin(), perera(), silva()], nextCursor: null }),
    ...methods,
  } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider, { client: queryClient },
    createElement(AuthProvider, {
      initialUser: meUser,
      children: createElement(ClientContext.Provider, {
        value: stub,
        children: createElement(OverlayProvider, {
          children: createElement('div', null, children, createElement(OverlayHost)),
        }),
      }),
    }),
  );
  return render(createElement(UserManagementScreen), { wrapper });
}

describe('UserManagementScreen', () => {
  beforeEach(() => {
    useWsStore.getState().reset();
  });

  it('loading: renders a skeleton', () => {
    build({ listUsers: () => new Promise(() => {}) });
    expect(screen.getByTestId('users-skeleton')).toBeInTheDocument();
  });

  it('populated: local+institute, mustReset and disabled all show', async () => {
    build();
    await waitFor(() => expect(screen.getByTestId('user-row-admin')).toBeInTheDocument());
    expect(screen.getByTestId('user-row-a.perera')).toBeInTheDocument();
    expect(screen.getByTestId('user-row-n.silva')).toHaveTextContent('must reset password');
  });

  it('empty (no match)', async () => {
    build({ listUsers: () => Promise.resolve({ items: [], nextCursor: null }) });
    await waitFor(() => expect(screen.getByText('No users match your search.')).toBeInTheDocument());
  });

  it('search filters via q', async () => {
    const listUsers = vi.fn(() => Promise.resolve({ items: [admin(), perera(), silva()], nextCursor: null }));
    build({ listUsers });
    await waitFor(() => expect(screen.getByLabelText('Search users')).toBeInTheDocument());
    expect(screen.getByLabelText('Search users')).toHaveAttribute('data-osk', 'default');
    fireEvent.change(screen.getByLabelText('Search users'), { target: { value: 'perera' } });
    await waitFor(() => expect(listUsers).toHaveBeenCalledWith(expect.objectContaining({ q: 'perera' })));
  });

  it('role filter chips call listUsers with the role', async () => {
    const listUsers = vi.fn(() => Promise.resolve({ items: [admin()], nextCursor: null }));
    build({ listUsers });
    await waitFor(() => expect(screen.getByText('Admin')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Admin'));
    await waitFor(() => expect(listUsers).toHaveBeenCalledWith(expect.objectContaining({ role: 'admin' })));
  });

  it('pagination: Load more appends via the next cursor', async () => {
    const listUsers = vi.fn()
      .mockResolvedValueOnce({ items: [admin()], nextCursor: 'C1' })
      .mockResolvedValueOnce({ items: [perera()], nextCursor: null });
    build({ listUsers });
    await waitFor(() => expect(screen.getByText('Load more')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Load more'));
    await waitFor(() => expect(screen.getByTestId('user-row-a.perera')).toBeInTheDocument());
  });

  it('add user: pending -> created', async () => {
    const createUser = vi.fn(() => Promise.resolve(perera({ id: 'NEW1', username: 'j.new' })));
    build({ createUser });
    await waitFor(() => expect(screen.getByTestId('user-row-admin')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Add user' }));
    expect(screen.getByLabelText('Username')).toHaveAttribute('data-osk', 'default');
    expect(screen.getByLabelText('Display name')).toHaveAttribute('data-osk', 'default');
    expect(screen.getByLabelText('Password')).toHaveAttribute('data-osk', 'default');
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'j.new' } });
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'J. New' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw12345' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add user' }));
    await waitFor(() => expect(createUser).toHaveBeenCalledWith({
      username: 'j.new', displayName: 'J. New', role: 'lecturer', password: 'pw12345',
    }));
  });

  it('add user 409: an existing username is refused', async () => {
    const createUser = vi.fn(() => Promise.reject(new ProblemError({ status: 409, code: 'conflict', title: 'admin already exists' })));
    build({ createUser });
    await waitFor(() => expect(screen.getByTestId('user-row-admin')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Add user' }));
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Dup' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw12345' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add user' }));
    await waitFor(() => expect(screen.getByText('admin already exists')).toBeInTheDocument());
  });

  it('edit user: institute-sourced fields are read-only', async () => {
    build();
    await waitFor(() => expect(screen.getByTestId('user-row-a.perera')).toBeInTheDocument());
    const row = screen.getByTestId('user-row-a.perera');
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Display name')).toBeDisabled();
    expect(screen.getByLabelText('Role')).toBeDisabled();
    expect(screen.getByLabelText('Display name')).toHaveAttribute('data-osk', 'default');
    expect(screen.getByLabelText('New password')).toHaveAttribute('data-osk', 'default');
  });

  it('delete user: pending -> deleted', async () => {
    const deleteUser = vi.fn(() => Promise.resolve(undefined));
    build({ deleteUser });
    await waitFor(() => expect(screen.getByTestId('user-row-n.silva')).toBeInTheDocument());
    const row = screen.getByTestId('user-row-n.silva');
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete user' }));
    await waitFor(() => expect(deleteUser).toHaveBeenCalledWith('L2'));
  });

  it('refuse last-admin/self: deleting admin (self, and last admin) is refused client-side', async () => {
    build();
    await waitFor(() => expect(screen.getByTestId('user-row-admin')).toBeInTheDocument());
    const row = screen.getByTestId('user-row-admin');
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
    expect(screen.getByText('You cannot delete your own account.')).toBeInTheDocument();
  });

  it('U-2: Add user is disabled while stale', async () => {
    build();
    await waitFor(() => expect(screen.getByTestId('user-row-admin')).toBeInTheDocument());
    act(() => useWsStore.setState({ stale: true }));
    expect(screen.getByRole('button', { name: 'Add user' })).toBeDisabled();
  });
});
