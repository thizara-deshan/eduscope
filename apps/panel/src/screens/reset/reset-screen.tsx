import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { AuthMessage } from '../../auth/auth-message.js';
import { useAuth } from '../../auth/auth-context.js';
import { PasswordField } from '../../auth/password-field.js';
import type { LoginLocationState } from '../../auth/session.js';
import { PolicyChecklist } from './policy-checklist.js';
import { PASSWORD_MAX_LENGTH } from './password-policy.js';
import { ResetCard } from './reset-card.js';
import { useChangePassword } from './use-change-password.js';

const REASON_TEXT =
  'Your account was created by an administrator. Choose a password only you know.';

/** Route element for /login/reset (S-02). */
export function ResetScreen(): JSX.Element {
  const { mustResetPassword } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const locationState = (location.state as LoginLocationState | null) ?? null;

  // Frozen at mount (W1-D-4): `success` clears `mustResetPassword` BEFORE
  // navigating, so a live derivation would flip forced -> voluntary mid-flight
  // and retarget the navigation.
  const [mode] = useState<'forced' | 'voluntary'>(() =>
    mustResetPassword ? 'forced' : 'voluntary',
  );

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const currentRef = useRef<HTMLInputElement>(null);

  const reset = useChangePassword({ currentPassword, newPassword, confirm });

  useEffect(() => {
    currentRef.current?.focus();
  }, []);

  useEffect(() => {
    if (reset.state.phase !== 'rejected-current') return;
    setCurrentPassword('');
    currentRef.current?.focus();
  }, [reset.state.phase]);

  useEffect(() => {
    if (reset.state.phase !== 'success') return;
    navigate(mode === 'forced' ? '/' : (locationState?.from ?? '/'), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot navigation keyed on the phase transition; mode/locationState.from are read once.
  }, [reset.state.phase]);

  const busy = reset.state.phase === 'submitting';

  const headerAction =
    mode === 'forced' ? (
      <button
        type="button"
        className="us-reset__headeraction"
        onClick={() => {
          reset.signOut();
          navigate('/login', { replace: true, state: { reason: 'logout' } });
        }}
      >
        Sign out
      </button>
    ) : (
      <button
        type="button"
        className="us-reset__headeraction"
        onClick={() => navigate(locationState?.from ?? '/', { replace: true })}
      >
        Cancel
      </button>
    );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (reset.canSubmit) reset.submit();
      }}
    >
      <ResetCard
        mode={mode}
        headerAction={headerAction}
        reason={<p className="us-reset__reason">{REASON_TEXT}</p>}
        fields={
          <>
            <PasswordField
              label="Current password"
              value={currentPassword}
              onChange={setCurrentPassword}
              disabled={busy}
              inputRef={currentRef}
            />
            <PasswordField
              label="New password"
              value={newPassword}
              onChange={(next) => setNewPassword(next.slice(0, PASSWORD_MAX_LENGTH))}
              disabled={busy}
              reveal
            />
            <PasswordField
              label="Confirm new password"
              value={confirm}
              onChange={(next) => setConfirm(next.slice(0, PASSWORD_MAX_LENGTH))}
              disabled={busy}
            />
          </>
        }
        message={<AuthMessage value={reset.message} />}
        checklist={<PolicyChecklist value={newPassword} confirm={confirm} />}
        action={
          <button type="submit" className="us-login__submit" disabled={!reset.canSubmit}>
            Set password
          </button>
        }
      />
    </form>
  );
}
