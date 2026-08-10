import { useState } from 'react';
import type { User, UserRole } from '@eduscope/shared';
import { ProblemError } from '@eduscope/api-client';
import { UserSearch } from './user-search.js';
import { UserTable } from './user-table.js';
import { AddUserDialog } from './add-user-dialog.js';
import { EditUserDialog } from './edit-user-dialog.js';
import { DeleteUserConfirm } from './delete-user-confirm.js';
import { useUsers } from './use-users.js';
import { useAuth } from '../../../auth/auth-context.js';
import { useIsStale } from '../../../store/selectors.js';
import './users.css';

/** S-32 — one directory, two roles; add/edit/delete/paginate/search. */
export function UserManagementScreen(): JSX.Element {
  const [q, setQ] = useState('');
  const [role, setRole] = useState<UserRole | undefined>(undefined);
  const { users, loading, hasMore, loadMore, createUser, updateUser, deleteUser } = useUsers({ q, role });
  const { user: me } = useAuth();
  const stale = useIsStale();

  const [adding, setAdding] = useState(false);
  const [addPending, setAddPending] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [editing, setEditing] = useState<User | null>(null);
  const [editPending, setEditPending] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [deleting, setDeleting] = useState<User | null>(null);
  const [deletePending, setDeletePending] = useState(false);

  const handleAdd = async (body: Parameters<typeof createUser>[0]) => {
    setAddPending(true);
    setAddError(null);
    try {
      await createUser(body);
      setAdding(false);
    } catch (error) {
      setAddError(error instanceof ProblemError ? error.problem.title : 'Could not create the user.');
    } finally {
      setAddPending(false);
    }
  };

  const handleEdit = async (body: Parameters<typeof updateUser>[1]) => {
    if (!editing) return;
    setEditPending(true);
    setEditError(null);
    try {
      await updateUser(editing.id, body);
      setEditing(null);
    } catch (error) {
      setEditError(error instanceof ProblemError ? error.problem.title : 'Could not save.');
    } finally {
      setEditPending(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletePending(true);
    try {
      await deleteUser(id);
      setDeleting(null);
    } finally {
      setDeletePending(false);
    }
  };

  return (
    <div className="us-users" data-testid="screen" data-screen="S-32">
      <div className="us-users__head">
        <h1>User Management</h1>
        <button type="button" className="us-adm__primary" disabled={stale} onClick={() => setAdding(true)}>Add user</button>
      </div>
      <UserSearch q={q} onQChange={setQ} role={role} onRoleChange={setRole} />
      {loading ? (
        <div className="us-device__skeleton" data-testid="users-skeleton" />
      ) : users.length === 0 ? (
        <p className="us-adm__note">No users match your search.</p>
      ) : (
        <>
          <UserTable users={users} onEdit={setEditing} onDelete={setDeleting} />
          {hasMore ? <button type="button" className="us-adm__secondary" onClick={loadMore}>Load more</button> : null}
        </>
      )}

      {adding ? (
        <AddUserDialog onSubmit={handleAdd} onCancel={() => setAdding(false)} pending={addPending} error={addError} />
      ) : null}

      {editing ? (
        <EditUserDialog user={editing} onSubmit={handleEdit} onCancel={() => setEditing(null)} pending={editPending} error={editError} />
      ) : null}

      {deleting && me ? (
        <DeleteUserConfirm
          target={deleting}
          allUsers={users}
          meId={me.id}
          onConfirm={handleDelete}
          onCancel={() => setDeleting(null)}
          state={deletePending ? 'pending' : 'confirm'}
          disabled={stale}
        />
      ) : null}
    </div>
  );
}
