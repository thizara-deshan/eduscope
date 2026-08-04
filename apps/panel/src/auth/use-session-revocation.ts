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
    navigate('/login', { replace: true, state: { reason } });
    // `navigate()` returns before the router's OWN transition has actually
    // applied (it is not synchronous even for a loader-less route change).
    // Clearing `user` in this same tick re-renders the still-mounted
    // `RequireRole` on the OLD route (its `user` read is a plain context
    // subscription, unaffected by the pending navigation) — it then fires
    // its own generic `state: { from }` redirect, a second `replace`
    // navigation that lands after this one and silently drops
    // `state: { reason }`, so the takeover/expired wording never reaches
    // S-01 (found live in the browser gate, Task 17). Deferring one turn
    // gives the router's transition time to actually commit first.
    setTimeout(() => setUser(null), 0);
  }, [reason, setUser, navigate]);
}
