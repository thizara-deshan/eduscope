import {
  zPage, zUser, zUserImportBatch,
  type Page, type Ulid, type User, type UserCreate, type UserImportBatch,
  type UserRole, type UserUpdate,
} from '@eduscope/shared';
import { ProblemError } from '../../errors.js';
import { validated, nowIsoZ, seedId } from '../seed/index.js';
import { SEED_CREDENTIALS } from '../seed/users.js';
import { requireAdmin } from './auth.js';
import type { RestContext } from './index.js';

const DEFAULT_LIMIT = 20;

export function createUsersOperations(ctx: RestContext) {
  const { world, engine, seed } = ctx;

  return {
    listUsers: async (query?: {
      cursor?: string;
      limit?: number;
      q?: string;
      role?: UserRole;
    }): Promise<Page<User>> => {
      requireAdmin(ctx);
      let rows = seed.users;
      if (query?.role) rows = rows.filter((u) => u.role === query.role);
      if (query?.q) {
        const needle = query.q.toLowerCase();
        rows = rows.filter(
          (u) => u.username.toLowerCase().includes(needle) || u.displayName.toLowerCase().includes(needle),
        );
      }
      const limit = query?.limit ?? DEFAULT_LIMIT;
      const start = query?.cursor ? Number.parseInt(query.cursor, 10) : 0;
      const page = rows.slice(start, start + limit);
      const nextCursor = start + limit < rows.length ? String(start + limit) : null;
      return validated(zPage(zUser), { items: page, nextCursor });
    },

    createUser: async (body: UserCreate): Promise<User> => {
      requireAdmin(ctx);
      const refusal = engine.onCommand('createUser');
      if (refusal) throw new ProblemError(refusal);
      if (seed.users.some((u) => u.username === body.username)) {
        throw new ProblemError({ status: 409, code: 'conflict', title: `${body.username} already exists` });
      }
      const user = validated(zUser, {
        id: seedId('user'),
        username: body.username,
        displayName: body.displayName,
        role: body.role,
        source: 'local',
        mustResetPassword: true,
        disabled: false,
        lastLoginAt: null,
        createdAt: nowIsoZ(world.clock),
      });
      seed.users.push(user);
      SEED_CREDENTIALS[body.username] = body.password;
      return user;
    },

    updateUser: async (userId: Ulid, body: UserUpdate): Promise<User> => {
      requireAdmin(ctx);
      const refusal = engine.onCommand('updateUser');
      if (refusal) throw new ProblemError(refusal);
      const row = seed.users.find((u) => u.id === userId);
      if (!row) throw new ProblemError({ status: 404, code: 'not-found', title: `Unknown user: ${userId}` });
      if (body.displayName !== undefined) row.displayName = body.displayName;
      if (body.role !== undefined) row.role = body.role;
      if (body.disabled !== undefined) row.disabled = body.disabled;
      if (body.password !== undefined) SEED_CREDENTIALS[row.username] = body.password;
      return validated(zUser, row);
    },

    deleteUser: async (userId: Ulid): Promise<void> => {
      requireAdmin(ctx);
      const refusal = engine.onCommand('deleteUser');
      if (refusal) throw new ProblemError(refusal);
      const index = seed.users.findIndex((u) => u.id === userId);
      if (index === -1) throw new ProblemError({ status: 404, code: 'not-found', title: `Unknown user: ${userId}` });
      // Recordings keep a tombstone owner reference (INV-U-5) — the row is
      // removed from the directory, but seed.recordings is left untouched.
      seed.users.splice(index, 1);
      return undefined;
    },

    // .xlsx parsing is out of scope for a REST mock (see task-10-report.md):
    // every import synchronously "succeeds" with a small synthetic batch
    // rather than reading `body.file`'s bytes.
    importUsers: async (body: { file: Blob | File }): Promise<UserImportBatch> => {
      requireAdmin(ctx);
      const refusal = engine.onCommand('importUsers');
      if (refusal) throw new ProblemError(refusal);
      void body.file;
      return validated(zUserImportBatch, {
        id: seedId('import-batch'),
        filename: 'roster.xlsx',
        uploadedAt: nowIsoZ(world.clock),
        state: 'applied',
        rowCount: 0,
        acceptedCount: 0,
        rejections: [],
      });
    },
  };
}
