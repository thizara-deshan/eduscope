import { useState } from 'react';
import type { UserCreate, UserRole } from '@eduscope/shared';

interface AddUserDialogProps {
  readonly onSubmit: (body: UserCreate) => void;
  readonly onCancel: () => void;
  readonly pending: boolean;
  readonly error: string | null;
}

export function AddUserDialog({ onSubmit, onCancel, pending, error }: AddUserDialogProps): JSX.Element {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<UserRole>('lecturer');
  const [password, setPassword] = useState('');

  const valid = username.trim() !== '' && displayName.trim() !== '' && password.trim() !== '';

  return (
    <div className="us-dangerconfirm__scrim" role="presentation">
      <div className="us-dangerconfirm" role="dialog" aria-label="Add user">
        <h2>Add user</h2>
        <label className="us-device__field">
          <span className="us-device__label">Username</span>
          <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} aria-label="Username" />
        </label>
        <label className="us-device__field">
          <span className="us-device__label">Display name</span>
          <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} aria-label="Display name" />
        </label>
        <label className="us-device__field">
          <span className="us-device__label">Role</span>
          <select value={role} onChange={(e) => setRole(e.target.value as UserRole)} aria-label="Role">
            <option value="lecturer">Lecturer</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <label className="us-device__field">
          <span className="us-device__label">Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} aria-label="Password" />
        </label>
        {error ? <p className="us-device__missing">{error}</p> : null}
        <footer className="us-dangerconfirm__footer">
          <button type="button" className="us-dangerconfirm__cancel" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className="us-adm__primary"
            disabled={!valid || pending}
            onClick={() => onSubmit({ username, displayName, role, password })}
          >
            {pending ? 'Creating…' : 'Add user'}
          </button>
        </footer>
      </div>
    </div>
  );
}
