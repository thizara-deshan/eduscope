import { Navigate } from 'react-router';
import { useAuth } from '../../auth/auth-context.js';

/** `/advanced` itself — role-specific landing category. */
export function AdvancedIndex(): JSX.Element {
  const { role } = useAuth();
  return <Navigate to={role === 'admin' ? '/advanced/network' : '/advanced/local-capture'} replace />;
}
