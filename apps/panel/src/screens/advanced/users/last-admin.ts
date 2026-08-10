import type { User } from '@eduscope/shared';

export interface CanDeleteResult {
  readonly ok: boolean;
  readonly reason?: string;
}

/** CG-9 — pure guard: refuse deleting self or the last admin. Client-side defence; the delete confirm reads it. */
export function canDelete(target: User, allUsers: User[], meId: string): CanDeleteResult {
  if (target.id === meId) {
    return { ok: false, reason: 'You cannot delete your own account.' };
  }
  if (target.role === 'admin') {
    const adminCount = allUsers.filter((u) => u.role === 'admin').length;
    if (adminCount <= 1) {
      return { ok: false, reason: 'This is the only admin account — at least one must remain.' };
    }
  }
  return { ok: true };
}
