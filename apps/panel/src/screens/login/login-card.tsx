import type { ReactNode } from 'react';
import { AuthMessage, type AuthMessageValue } from '../../auth/auth-message.js';
import './login.css';

/**
 * Auth-blind (S-01 §4): the only piece with layout math in it, so the
 * geometry in S-01 §2 can be tested without a client. No role picker
 * (S01-D-1) — by C-1 there is nothing readable pre-auth to put there.
 */
export function LoginCard({
  message,
  fields,
  action,
}: {
  message: AuthMessageValue;
  fields: ReactNode;
  action: ReactNode;
}): JSX.Element {
  return (
    <div className="us-login">
      <div className="us-login__card">
        <div className="us-login__band" aria-hidden="true">
          <span className="us-login__logo">Eduscope</span>
        </div>
        <div className="us-login__body">
          <h1 className="us-login__title">Welcome back</h1>
          <p className="us-login__sub">Sign in to your recording panel</p>
          <div className="us-login__fields">{fields}</div>
          <AuthMessage value={message} />
          {action}
        </div>
      </div>
    </div>
  );
}
