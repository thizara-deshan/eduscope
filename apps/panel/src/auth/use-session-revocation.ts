import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from './auth-context.js';
import { revokedReason } from './session.js';
import { clearTokens } from './token-store.js';

/**
 * A revoked session is not an error card — it is a return to S-01 carrying the
 * word that explains it (S-01 §5 `session expired`, R-21 for `takeover`). Pass
 * any query/mutation error; a non-revocation error is ignored so a caller can
 * hand over `query.error` unconditionally.
 */
export function useSessionRevocation(error: unknown): void {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const reason = revokedReason(error);

  useEffect(() => {
    if (!reason) return;
    clearTokens();
    setUser(null);
    navigate('/login', { replace: true, state: { reason } });
  }, [reason, setUser, navigate]);
}
