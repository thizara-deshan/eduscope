import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AuthProvider } from './auth-context.js';
import { RequireRole } from './require-role.js';

const user = (role: 'lecturer' | 'admin', mustResetPassword = false) => ({
  id: '01JBQ8ZK3T7WBM5N2Q4XPRVC9D',
  username: 'u', displayName: 'U', role, source: 'local' as const,
  mustResetPassword, disabled: false, lastLoginAt: null,
  createdAt: '2026-01-01T00:00:00+00:00',
});

function at(path: string, u: ReturnType<typeof user> | null) {
  return render(
    <AuthProvider initialUser={u}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/login" element={<p>login</p>} />
          <Route path="/login/reset" element={<p>reset</p>} />
          <Route
            path="/"
            element={<RequireRole><p>dashboard</p></RequireRole>}
          />
          <Route
            path="/advanced/users"
            // RequireRole's `role` prop is a UserRole (custom component prop),
            // not an ARIA role attribute; the lint rule doesn't distinguish them.
            // eslint-disable-next-line jsx-a11y/aria-role
            element={<RequireRole role="admin"><p>users</p></RequireRole>}
          />
          <Route path="/advanced/local-capture" element={<p>local capture</p>} />
          <Route
            path="/advanced/network"
            // eslint-disable-next-line jsx-a11y/aria-role
            element={<RequireRole role="admin" redirectTo="/advanced/local-capture"><p>network</p></RequireRole>}
          />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe('role gating', () => {
  it('lets an admin through', () => {
    at('/advanced/users', user('admin'));
    expect(screen.getByText('users')).toBeTruthy();
  });

  it('sends a lecturer back to the role-scoped shell, not a 403 page (U-6)', () => {
    at('/advanced/users', user('lecturer'));
    expect(screen.queryByText('users')).toBeNull();
    expect(screen.getByText('dashboard')).toBeTruthy();
  });

  it('sends an unauthenticated visitor to login', () => {
    at('/advanced/users', null);
    expect(screen.getByText('login')).toBeTruthy();
  });

  it('redirects to the forced reset while mustResetPassword is true (U-7)', () => {
    at('/', user('lecturer', true));
    expect(screen.getByText('reset')).toBeTruthy();
  });

  it('honors an explicit redirectTo instead of the default "/" on a role mismatch', () => {
    at('/advanced/network', user('lecturer'));
    expect(screen.queryByText('network')).toBeNull();
    expect(screen.getByText('local capture')).toBeTruthy();
  });
});
