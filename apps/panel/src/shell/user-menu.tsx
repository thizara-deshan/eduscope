import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useAuth } from '../auth/auth-context.js';
import { clearTokens } from '../auth/token-store.js';
import { useClient } from '../client/client-provider.js';
import './shell.css';

/**
 * The user name becomes a `▾` menu (S02-D-8): two >=56px rows — Change
 * password (the only door to S-02's `voluntary` mode) and Sign out. A real
 * popup — `aria-haspopup`/`aria-expanded`/`role="menu"` — opens on tap only,
 * closes on Escape/outside tap/selection. Renders absolutely inside
 * `.us-panel`, never `fixed`.
 */
export function UserMenu({ displayName }: { displayName: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const client = useClient();
  const { setUser } = useAuth();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  return (
    <div className="us-usermenu" ref={rootRef}>
      <button
        type="button"
        className="us-usermenu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {displayName} ▾
      </button>
      {open && (
        <div className="us-usermenu__popup" role="menu">
          <button
            type="button"
            role="menuitem"
            className="us-usermenu__item"
            onClick={() => {
              setOpen(false);
              navigate('/login/reset', { state: { from: location.pathname } });
            }}
          >
            Change password
          </button>
          <button
            type="button"
            role="menuitem"
            className="us-usermenu__item"
            onClick={() => {
              setOpen(false);
              void client.logout().then(() => {
                clearTokens();
                setUser(null);
                navigate('/login', { state: { reason: 'logout' } });
              });
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
