import type { User } from '@eduscope/shared';

interface UserTableProps {
  readonly users: readonly User[];
  readonly onEdit: (user: User) => void;
  readonly onDelete: (user: User) => void;
}

/** S-32 — rows >= 56px; the action column is persistent, never hover-revealed. */
export function UserTable({ users, onEdit, onDelete }: UserTableProps): JSX.Element {
  return (
    <table className="us-users__table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Username</th>
          <th>Role</th>
          <th>Source</th>
          <th>Last login</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {users.map((u) => (
          <tr key={u.id} className="us-users__row" data-testid={`user-row-${u.username}`}>
            <td>{u.displayName}</td>
            <td>{u.username}</td>
            <td>{u.role}</td>
            <td>{u.source}</td>
            <td>{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'never'}</td>
            <td>
              {u.disabled ? <span className="us-device__missing">disabled</span> : null}
              {u.mustResetPassword ? <span className="us-adm__note">must reset password</span> : null}
              {!u.disabled && !u.mustResetPassword ? <span className="us-adm__note">active</span> : null}
            </td>
            <td className="us-users__actions">
              <button type="button" className="us-adm__secondary" onClick={() => onEdit(u)}>Edit</button>
              <button type="button" className="us-adm__secondary" onClick={() => onDelete(u)}>Delete</button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
