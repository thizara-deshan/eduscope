import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as rest from '../src/schemas/rest.js';

const spec = readFileSync(
  resolve(__dirname, '../../../contracts/openapi.yaml'),
  'utf8',
);

/** Names under `components.schemas` — 4-space indent, directly after the block header. */
function contractSchemaNames(): string[] {
  const lines = spec.split('\n');
  const start = lines.findIndex((l) => l.trimEnd() === '  schemas:');
  expect(start, 'components.schemas block not found').toBeGreaterThan(-1);
  const names: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^ {0,3}\S/.test(line)) break; // dedented out of components
    const m = /^ {4}([A-Za-z][A-Za-z0-9]*):\s*$/.exec(line);
    if (m?.[1]) names.push(m[1]);
  }
  return names;
}

describe('rest schema coverage', () => {
  const names = contractSchemaNames();

  it('finds the contract schemas', () => {
    expect(names.length).toBeGreaterThan(100);
    expect(names).toContain('RecordingStateSnapshot');
    expect(names).toContain('Problem');
  });

  it('exports a zod schema for every contract schema', () => {
    const missing = names.filter((n) => !(`z${n}` in rest));
    expect(missing, `no zod export for: ${missing.join(', ')}`).toEqual([]);
  });

  it('parses a valid RecordingStateSnapshot including its nullable fields', () => {
    const idle = {
      state: 'idle',
      startReason: null,
      sessionId: null,
      title: null,
      ownerUserId: null,
      ownerDisplayName: null,
      startedAt: null,
      recordedDurationMs: null,
      segmentIndex: null,
      segmentCount: null,
      pauseCount: null,
      takeoverBy: null,
      errorCode: null,
      errorMessage: null,
    };
    expect(rest.zRecordingStateSnapshot.parse(idle)).toMatchObject({ state: 'idle' });
  });

  it('rejects a non-ULID id', () => {
    expect(() => rest.zUlid.parse('not-a-ulid')).toThrow();
    expect(rest.zUlid.parse('01JBQ8ZK3T7WBM5N2Q4XPRVC9D')).toBeTruthy();
  });

  it('exposes the cursor-pagination envelope', () => {
    const page = rest.zPage(rest.zUlid);
    expect(page.parse({ items: [], nextCursor: null })).toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it('preserves unknown keys in open-ended fields (additionalProperties: true)', () => {
    // openapi.yaml declares Problem.meta, LogEntry.context, and SystemAlert.context
    // as `additionalProperties: true`. The generator renders these as bare
    // `z.object({})`, whose default "strip" mode would silently discard real
    // content. rest.ts overrides all three with `.catchall(z.unknown())`; this
    // proves the override actually keeps the data instead of stripping it.
    const problem = {
      status: 409,
      code: 'conflict',
      title: 'Role already bound',
      meta: { roleId: 'presentation', ownerUserId: '01JBQ8ZK3T7WBM5N2Q4XPRVC9D' },
    };
    expect(rest.zProblem.parse(problem).meta).toEqual({
      roleId: 'presentation',
      ownerUserId: '01JBQ8ZK3T7WBM5N2Q4XPRVC9D',
    });
  });

  // ── contract v0.2 (docs/design/contract-amendments.md, 2026-08-04) ──

  it('CG-10: auth.account-disabled is a Problem code', () => {
    expect(rest.zProblem.shape.code.options).toContain('auth.account-disabled');
  });

  it('CG-11: Problem.meta.reason is typed and closed, and the catchall survives it', () => {
    const revoked = {
      status: 401,
      code: 'auth.session-revoked',
      title: 'Session revoked',
      meta: { reason: 'takeover', revokedBy: 'D. Admin' },
    };
    // The override in rest.ts must keep BOTH: the declared key stays typed, and
    // undeclared keys are still preserved rather than stripped.
    expect(rest.zProblem.parse(revoked).meta).toEqual({
      reason: 'takeover',
      revokedBy: 'D. Admin',
    });
    expect(rest.zSessionRevokedReason.options).toEqual(['expired', 'logout', 'takeover', 'admin']);
    expect(() => rest.zProblem.parse({ ...revoked, meta: { reason: 'because' } })).toThrow();
  });

  it('CG-12: newPassword is legacy parity — 8+ with a digit, an upper and a lower (B-42)', () => {
    const ok = (newPassword: string) =>
      rest.zChangePasswordRequest.safeParse({ currentPassword: 'x', newPassword }).success;
    expect(ok('Lecture-hall-7')).toBe(true);
    expect(ok('Short1A')).toBe(false); // < 8
    expect(ok('alllowercase1')).toBe(false); // no uppercase
    expect(ok('ALLUPPERCASE1')).toBe(false); // no lowercase
    expect(ok('NoDigitsHere')).toBe(false); // no digit
  });
});
