import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import type { SessionRevokedReason } from '@eduscope/shared';
import type { AuthMessageValue } from '../../auth/auth-message.js';
import { PasswordField } from '../../auth/password-field.js';
import { TAKEOVER_REVOKED_SENTENCE, type LoginLocationState } from '../../auth/session.js';
import { useOskField } from '../../keyboard/use-keyboard.js';
import { LoginCard } from './login-card.js';
import { useLogin } from './use-login.js';

/** S-01 §6. `logout` renders no message — the user meant to. */
const REASON_COPY: Record<SessionRevokedReason, string | null> = {
  expired: 'Your session ended after a period of inactivity. Sign in again.',
  takeover: `${TAKEOVER_REVOKED_SENTENCE} Sign in again to continue.`,
  admin: 'An administrator ended your session. Sign in again.',
  logout: null,
};

function arrivalMessage(reason: SessionRevokedReason | null): AuthMessageValue {
  if (!reason) return null;
  const text = REASON_COPY[reason];
  return text ? { kind: 'info', text } : null;
}

/** Route element for /login (S-01). Holds field values, calls use-login, navigates. */
export function LoginScreen(): JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const locationState = (location.state as LoginLocationState | null) ?? null;

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  // Read once on arrival; cleared on the first edit so a stale reason never
  // survives a retry (precedence: a live use-login message always wins).
  const [reason, setReason] = useState<SessionRevokedReason | null>(locationState?.reason ?? null);

  const login = useLogin({ username, password });
  const usernameBinding = useOskField({ value: username, onChange: setUsername });
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // Autofocus via ref + effect, not the `autoFocus` attribute
  // (jsx-a11y/no-autofocus is an error) — opens the keyboard before first
  // paint so the card renders in its 393px geometry immediately (S-01 §3).
  useEffect(() => {
    usernameRef.current?.focus();
  }, []);

  useEffect(() => {
    if (login.state.phase !== 'rejected') return;
    setPassword('');
    passwordRef.current?.focus();
  }, [login.state.phase]);

  useEffect(() => {
    if (login.state.phase !== 'success') return;
    navigate(locationState?.from ?? '/', { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- navigate on success is a one-shot effect keyed on the phase transition; locationState.from is read once, not tracked live.
  }, [login.state.phase]);

  if (login.state.phase === 'must-reset') {
    return <Navigate to="/login/reset" replace />;
  }

  const busy = login.state.phase === 'submitting';
  const message = login.message ?? arrivalMessage(reason);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (login.canSubmit) login.submit();
      }}
    >
      <LoginCard
        message={message}
        fields={
          <>
            <div className="us-field">
              <label className="us-field__label" htmlFor="us-login-username">Username</label>
              <div className="us-field__row">
                <input
                  id="us-login-username"
                  ref={usernameRef}
                  className="us-input"
                  value={username}
                  disabled={busy}
                  autoComplete="off"
                  name="us-login-username"
                  aria-label="Username"
                  onChange={(e) => {
                    setReason(null);
                    setUsername(e.target.value);
                  }}
                  onFocus={usernameBinding.onFocus}
                  onBlur={usernameBinding.onBlur}
                  data-osk={usernameBinding['data-osk']}
                />
              </div>
            </div>
            <PasswordField
              label="Password"
              value={password}
              onChange={(next) => {
                setReason(null);
                setPassword(next);
              }}
              disabled={busy}
              inputRef={passwordRef}
            />
          </>
        }
        action={
          <button type="submit" className="us-login__submit" disabled={!login.canSubmit}>
            Log In
          </button>
        }
      />
    </form>
  );
}
