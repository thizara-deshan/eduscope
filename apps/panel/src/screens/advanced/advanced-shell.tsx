import { useQuery } from '@tanstack/react-query';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../../auth/auth-context.js';
import { useClient } from '../../client/client-provider.js';
import { ADVANCED_NAV_ITEMS, navItemsForRole } from './advanced-nav.js';
import './advanced.css';

/**
 * S-25 — the role-scoped Advanced shell. Admins see the full System
 * Administration list (10 items); lecturers see only their two output pages
 * (AD-1). U-6: a lecturer landing on an admin-only route gets this
 * role-scoped shell, never a 403 — see `advanced-index.tsx`'s redirect and
 * `require-role.tsx`'s `redirectTo`.
 */
export function AdvancedShell(): JSX.Element {
  const auth = useAuth();
  const client = useClient();
  const location = useLocation();
  const navigate = useNavigate();
  // A cold-render seam independent of AuthProvider's own state (U-1) — in the
  // real app `auth.role` is already set by the time RequireRole admits this
  // route, so this only ever shows before that.
  const meQuery = useQuery({ queryKey: ['me'], queryFn: () => client.getMe() });
  const role = auth.role ?? meQuery.data?.role ?? null;

  if (!role) {
    return <div className="us-adm" data-testid="advanced-shell-skeleton" />;
  }

  const isAdmin = role === 'admin';
  const items = navItemsForRole(role);

  return (
    <div className="us-adm" data-testid="advanced-shell">
      <header className="us-adm__topbar">
        <span className="us-adm__title">
          {isAdmin ? 'System Administration' : 'Advanced'}
        </span>
        <button
          type="button"
          className="us-adm__back"
          onClick={() => navigate('/')}
        >
          Back to Dashboard
        </button>
      </header>

      <div className="us-adm__layout">
        <nav className="us-adm__sidebar" aria-label="Administration categories">
          <span className="us-adm__navlabel">{isAdmin ? 'Categories' : 'Outputs'}</span>
          {items.map(({ path, label, icon }) => {
            const active = location.pathname === path;
            return (
              <button
                key={path}
                type="button"
                className={`us-adm__navitem${active ? ' us-adm__navitem--active' : ''}`}
                onClick={() => navigate(path)}
                aria-current={active ? 'page' : undefined}
              >
                <span aria-hidden="true">{icon}</span>
                {label}
              </button>
            );
          })}
        </nav>

        <main className="us-adm__content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export { ADVANCED_NAV_ITEMS };
