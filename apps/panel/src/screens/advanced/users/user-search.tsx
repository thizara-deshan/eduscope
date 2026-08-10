import type { UserRole } from '@eduscope/shared';

interface UserSearchProps {
  readonly q: string;
  readonly onQChange: (q: string) => void;
  readonly role: UserRole | undefined;
  readonly onRoleChange: (role: UserRole | undefined) => void;
}

const ROLES: readonly { readonly label: string; readonly value: UserRole | undefined }[] = [
  { label: 'All', value: undefined },
  { label: 'Lecturer', value: 'lecturer' },
  { label: 'Admin', value: 'admin' },
];

export function UserSearch({ q, onQChange, role, onRoleChange }: UserSearchProps): JSX.Element {
  return (
    <div className="us-users__search">
      <input
        type="text"
        value={q}
        onChange={(e) => onQChange(e.target.value)}
        placeholder="Search name or username"
        aria-label="Search users"
      />
      <div className="us-users__rolefilter">
        {ROLES.map((r) => (
          <button
            key={r.label}
            type="button"
            className={`us-users__chip${role === r.value ? ' us-users__chip--active' : ''}`}
            onClick={() => onRoleChange(r.value)}
          >
            {r.label}
          </button>
        ))}
      </div>
    </div>
  );
}
