import type { User } from '@eduscope/shared';
import { DangerConfirm, type DangerConfirmState } from '../../../danger/danger-confirm.js';
import { canDelete } from './last-admin.js';

interface DeleteUserConfirmProps {
  readonly target: User;
  readonly allUsers: readonly User[];
  readonly meId: string;
  readonly onConfirm: (id: string) => void;
  readonly onCancel: () => void;
  readonly state: DangerConfirmState;
  readonly disabled: boolean;
}

/** S-32 — delete confirm reads the CG-9 guard client-side; a refused delete never reaches the server. */
export function DeleteUserConfirm({ target, allUsers, meId, onConfirm, onCancel, state, disabled }: DeleteUserConfirmProps): JSX.Element {
  const guard = canDelete(target, [...allUsers], meId);

  return (
    <DangerConfirm
      title={`Delete ${target.username}`}
      body={<p>This removes {target.displayName} from the directory. Their past recordings keep a tombstone owner reference.</p>}
      confirmLabel="Delete user"
      pendingLabel="Deleting…"
      state={!guard.ok ? 'refused' : state}
      message={!guard.ok ? guard.reason : null}
      onCancel={onCancel}
      onConfirm={() => onConfirm(target.id)}
      confirmDisabled={disabled}
    />
  );
}
