import { Navigate, useLocation } from 'react-router';
import type { UserRole } from '@eduscope/shared';
import type { ReactNode } from 'react';
import { useAuth } from './auth-context.js';

/**
 * The UI gate is convenience; the server gate is the security boundary
 * (screen-inventory §1.1, PF-17, INV-U-4). A lecturer reaching an admin route
 * gets the role-scoped shell, NOT a 403 page (U-6) — the nav never offers what
 * the role cannot use, so arriving here at all is an anomaly.
 */
export function RequireRole({
  role,
  children,
}: {
  role?: UserRole;
  children: ReactNode;
}) {
  const { user, mustResetPassword } = useAuth();
  const location = useLocation();

  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  // U-7: the router redirects rather than rendering the 403 the API would send.
  if (mustResetPassword && location.pathname !== '/login/reset') {
    return <Navigate to="/login/reset" replace />;
  }

  if (role && user.role !== role) return <Navigate to="/" replace />;

  return <>{children}</>;
}
