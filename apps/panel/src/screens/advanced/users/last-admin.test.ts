import { describe, expect, it } from 'vitest';
import type { User } from '@eduscope/shared';
import { canDelete } from './last-admin.js';

const user = (overrides: Partial<User> = {}): User => ({
  id: 'U1', username: 'x', displayName: 'X', role: 'lecturer', source: 'local',
  mustResetPassword: false, disabled: false, lastLoginAt: null, createdAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('canDelete', () => {
  it('blocks deleting self', () => {
    const me = user({ id: 'ME', role: 'admin' });
    const other = user({ id: 'A2', role: 'admin' });
    expect(canDelete(me, [me, other], 'ME').ok).toBe(false);
  });

  it('blocks deleting the sole admin', () => {
    const admin = user({ id: 'A1', role: 'admin' });
    const lecturer = user({ id: 'L1', role: 'lecturer' });
    expect(canDelete(admin, [admin, lecturer], 'L1').ok).toBe(false);
  });

  it('allows deleting a lecturer with two admins present', () => {
    const admin1 = user({ id: 'A1', role: 'admin' });
    const admin2 = user({ id: 'A2', role: 'admin' });
    const lecturer = user({ id: 'L1', role: 'lecturer' });
    expect(canDelete(lecturer, [admin1, admin2, lecturer], 'A1')).toEqual({ ok: true });
  });

  it('allows deleting an admin when another admin remains', () => {
    const admin1 = user({ id: 'A1', role: 'admin' });
    const admin2 = user({ id: 'A2', role: 'admin' });
    expect(canDelete(admin2, [admin1, admin2], 'A1')).toEqual({ ok: true });
  });
});
