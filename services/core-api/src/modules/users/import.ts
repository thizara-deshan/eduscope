import type { UserImportBatch } from '@eduscope/shared';
import ExcelJS from 'exceljs';
import { ProblemError } from '../../contracts/problem.js';
import { userImportBatches, users } from '../../db/schema.js';
import { hashPassword } from '../auth/passwords.js';
import type { AuthContext } from '../auth/service.js';
import type { UsersServiceDeps } from './service.js';

/** AD-6/B-44: the exact roster columns, matched by header name (order-independent). */
const REQUIRED_COLUMNS = ['username', 'displayName', 'role', 'password', 'source', 'externalId'] as const;
type RequiredColumn = (typeof REQUIRED_COLUMNS)[number];

type RejectionReason = 'empty-cell' | 'duplicate-username-in-file' | 'username-exists' | 'invalid-role' | 'invalid-format';

interface RowRejection {
  row: number;
  column: string;
  reason: RejectionReason;
}

interface ParsedImportRow {
  row: number;
  username: string;
  displayName: string;
  role: 'lecturer' | 'admin';
  password: string;
  source: 'local' | 'institute';
  externalId: string | null;
}

export interface ImportUsersInput {
  filename: string;
  buffer: Buffer;
}

export interface ImportUsersResult {
  status: 201 | 422;
  batch: UserImportBatch;
}

function toBatchPayload(row: typeof userImportBatches.$inferSelect): UserImportBatch {
  return {
    id: row.id,
    filename: row.filename,
    uploadedAt: row.uploadedAt,
    state: row.state,
    rowCount: row.rowCount,
    acceptedCount: row.acceptedCount,
    rejections: row.rejections as UserImportBatch['rejections'],
  };
}

/** Reads a cell as trimmed text, treating blank/whitespace-only and null/undefined alike as empty (INV-UI). */
function cellText(row: ExcelJS.Row, colNumber: number): string | null {
  const value = row.getCell(colNumber).value;
  if (value === null || value === undefined) return null;
  if (typeof value === 'object' && 'richText' in value) {
    const richText = (value as { richText: Array<{ text: string }> }).richText;
    const text = richText.map((part) => part.text).join('').trim();
    return text.length > 0 ? text : null;
  }
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function resolveColumnIndex(sheet: ExcelJS.Worksheet): Record<RequiredColumn, number> {
  const found = new Map<string, number>();
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const name = typeof cell.value === 'string' ? cell.value.trim() : '';
    if (name) found.set(name, colNumber);
  });

  const missing = REQUIRED_COLUMNS.filter((column) => !found.has(column));
  if (missing.length > 0) {
    throw new ProblemError(422, 'validation.invalid', `Missing required column(s): ${missing.join(', ')}`);
  }

  return Object.fromEntries(REQUIRED_COLUMNS.map((column) => [column, found.get(column)!])) as Record<RequiredColumn, number>;
}

function parseRows(sheet: ExcelJS.Worksheet, columns: Record<RequiredColumn, number>, existingUsernames: Set<string>): {
  rows: ParsedImportRow[];
  rejections: RowRejection[];
} {
  const rows: ParsedImportRow[] = [];
  const rejections: RowRejection[] = [];
  const seenInFile = new Set<string>();

  const lastRowNumber = sheet.lastRow?.number ?? 1;
  for (let rowNumber = 2; rowNumber <= lastRowNumber; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    if (row.cellCount === 0) continue; // fully blank row

    const username = cellText(row, columns.username);
    const displayName = cellText(row, columns.displayName);
    const roleRaw = cellText(row, columns.role);
    const password = cellText(row, columns.password);
    const sourceRaw = cellText(row, columns.source);
    const externalId = cellText(row, columns.externalId);

    const requiredFields: Array<[RequiredColumn, string | null]> = [
      ['username', username],
      ['displayName', displayName],
      ['role', roleRaw],
      ['password', password],
      ['source', sourceRaw],
    ];
    const emptyField = requiredFields.find(([, value]) => value === null);
    if (emptyField) {
      rejections.push({ row: rowNumber, column: emptyField[0], reason: 'empty-cell' });
      continue;
    }

    if (roleRaw !== 'lecturer' && roleRaw !== 'admin') {
      rejections.push({ row: rowNumber, column: 'role', reason: 'invalid-role' });
      continue;
    }
    if (sourceRaw !== 'local' && sourceRaw !== 'institute') {
      rejections.push({ row: rowNumber, column: 'source', reason: 'invalid-format' });
      continue;
    }
    if (seenInFile.has(username!)) {
      rejections.push({ row: rowNumber, column: 'username', reason: 'duplicate-username-in-file' });
      continue;
    }
    if (existingUsernames.has(username!)) {
      rejections.push({ row: rowNumber, column: 'username', reason: 'username-exists' });
      continue;
    }

    seenInFile.add(username!);
    rows.push({ row: rowNumber, username: username!, displayName: displayName!, role: roleRaw, password: password!, source: sourceRaw, externalId });
  }

  return { rows, rejections };
}

/**
 * `importUsers` (openapi.yaml, AD-6/B-44 KEEP): all-or-nothing (INV-UI-1) —
 * every row is validated before any write. A rejected batch writes only its
 * own row, carrying every rejection; an accepted batch inserts all users and
 * the applied batch atomically. Every imported user forces a reset on first
 * login (INV-UI-2). The workbook buffer is never persisted to disk and is
 * discarded once this function returns (INV-UI-3) — nothing here logs cell
 * contents, so a plaintext password never reaches disk or a log line.
 */
export async function importUsers(deps: UsersServiceDeps, actor: AuthContext, input: ImportUsersInput): Promise<ImportUsersResult> {
  const workbook = new ExcelJS.Workbook();
  try {
    // exceljs's bundled Buffer type resolves against a different `@types/node`
    // instantiation than this workspace's — structurally identical at runtime.
    await workbook.xlsx.load(input.buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  } catch {
    throw new ProblemError(422, 'validation.invalid', 'Uploaded file is not a valid .xlsx workbook');
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw new ProblemError(422, 'validation.invalid', 'Workbook has no worksheet');
  }
  const columns = resolveColumnIndex(sheet);

  const existingUsernames = new Set(deps.db.select({ username: users.username }).from(users).all().map((row) => row.username));
  const { rows, rejections } = parseRows(sheet, columns, existingUsernames);

  const now = deps.clock.now();
  const nowIso = now.toISOString();
  const batchId = deps.ids.next(now);

  if (rejections.length > 0) {
    const batchRow = {
      id: batchId,
      filename: input.filename,
      uploadedBy: actor.userId,
      uploadedAt: nowIso,
      state: 'rejected' as const,
      rowCount: rows.length + rejections.length,
      acceptedCount: 0,
      rejections,
    };
    deps.db.insert(userImportBatches).values(batchRow).run();
    return { status: 422, batch: toBatchPayload(batchRow) };
  }

  const hashedRows = await Promise.all(
    rows.map(async (row) => ({
      ...row,
      passwordHash: await hashPassword(row.password),
    })),
  );

  const batchRow = {
    id: batchId,
    filename: input.filename,
    uploadedBy: actor.userId,
    uploadedAt: nowIso,
    state: 'applied' as const,
    rowCount: hashedRows.length,
    acceptedCount: hashedRows.length,
    rejections: [],
  };

  deps.db.transaction((tx) => {
    tx.insert(userImportBatches).values(batchRow).run();
    for (const row of hashedRows) {
      tx.insert(users)
        .values({
          id: deps.ids.next(now),
          username: row.username,
          displayName: row.displayName,
          role: row.role,
          source: row.source,
          externalId: row.externalId,
          passwordHash: row.passwordHash,
          mustResetPassword: true,
          disabled: false,
          lastLoginAt: null,
          createdAt: nowIso,
          createdBy: actor.userId,
          importBatchId: batchId,
        })
        .run();
    }
  });

  return { status: 201, batch: toBatchPayload(batchRow) };
}
