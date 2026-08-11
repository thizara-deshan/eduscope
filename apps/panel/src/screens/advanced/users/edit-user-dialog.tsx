import { useState } from 'react';
import type { User, UserRole, UserUpdate } from '@eduscope/shared';
import { useOskField } from '../../../keyboard/use-keyboard.js';

interface EditUserDialogProps {
  readonly user: User;
  readonly onSubmit: (body: UserUpdate) => void;
  readonly onCancel: () => void;
  readonly pending: boolean;
  readonly error: string | null;
}

/** S-32 — institute-sourced fields (displayName/role) are roster-owned, read-only (PF-8, [D-02b]). */
export function EditUserDialog({ user, onSubmit, onCancel, pending, error }: EditUserDialogProps): JSX.Element {
  const readOnly = user.source === 'institute';
  const [displayName, setDisplayName] = useState(user.displayName);
  const [role, setRole] = useState<UserRole>(user.role);
  const [disabled, setDisabled] = useState(user.disabled);
  const [password, setPassword] = useState('');
  const displayNameBinding = useOskField({ value: displayName, onChange: setDisplayName });
  const passwordBinding = useOskField({ value: password, onChange: setPassword });

  return (
    <div className="us-dangerconfirm__scrim" role="presentation">
      <div className="us-dangerconfirm" role="dialog" aria-label={`Edit ${user.username}`}>
        <h2>Edit {user.username}</h2>
        {readOnly ? (
          <p className="us-adm__note">Roster-owned fields (name, role) are managed by the institute and read-only here.</p>
        ) : null}
        <label className="us-device__field">
          <span className="us-device__label">Display name</span>
          <input
            type="text"
            value={displayName}
            disabled={readOnly}
            onChange={(e) => setDisplayName(e.target.value)}
            aria-label="Display name"
            {...displayNameBinding}
          />
        </label>
        <label className="us-device__field">
          <span className="us-device__label">Role</span>
          <select value={role} disabled={readOnly} onChange={(e) => setRole(e.target.value as UserRole)} aria-label="Role">
            <option value="lecturer">Lecturer</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <label className="us-device__field">
          <span className="us-device__label">
            <input type="checkbox" checked={disabled} onChange={(e) => setDisabled(e.target.checked)} aria-label="Disabled" />
            Disabled
          </span>
        </label>
        <label className="us-device__field">
          <span className="us-device__label">New password (optional, forces reset)</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} aria-label="New password" {...passwordBinding} />
        </label>
        {error ? <p className="us-device__missing">{error}</p> : null}
        {/* Keep the pressed field focused so the on-screen keyboard neither
            closes nor reflows the dialog between mousedown and click — otherwise
            the footer slides out from under the tap and the action is lost. */}
        <footer className="us-dangerconfirm__footer" onMouseDown={(e) => e.preventDefault()}>
          <button type="button" className="us-dangerconfirm__cancel" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className="us-adm__primary"
            disabled={pending}
            onClick={() => onSubmit({
              ...(readOnly ? {} : { displayName, role }),
              disabled,
              ...(password ? { password } : {}),
            })}
          >
            {pending ? 'Saving…' : 'Save'}
          </button>
        </footer>
      </div>
    </div>
  );
}
