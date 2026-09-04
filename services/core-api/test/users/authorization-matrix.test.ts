import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PANEL_OPERATION_IDS, type PanelOperationId } from '@eduscope/shared';
import { OPERATION_AUTHORIZATION } from '../../src/modules/users/service.js';

const OPENAPI_PATH = resolve(import.meta.dirname, '../../../../contracts/openapi.yaml');

/** Every operationId with `x-required-role: admin` directly under it, per openapi.yaml. */
function adminGatedOperations(): Set<string> {
  const source = readFileSync(OPENAPI_PATH, 'utf8');
  const gated = new Set<string>();
  let currentOperationId: string | null = null;
  for (const line of source.split('\n')) {
    const opMatch = /^\s*operationId:\s*(\S+)\s*$/.exec(line);
    if (opMatch?.[1] !== undefined) {
      currentOperationId = opMatch[1];
      continue;
    }
    if (/x-required-role:\s*admin\s*$/.test(line) && currentOperationId !== null) {
      gated.add(currentOperationId);
    }
  }
  return gated;
}

/**
 * Every operationId registered with `preHandler: requireAuth(...)` — i.e.
 * every operation that needs a bearer token at all. `login`/`refreshToken`
 * are the only two operations that never call `requireAuth`.
 */
interface RouteScan {
  registered: Set<string>;
  authenticated: Set<string>;
}

/** Scans `src/modules/**` for `operationId: '...'` route registrations. Operations from a module future Workstream B tasks haven't landed yet are simply absent — not misclassified. */
function scanRoutes(): RouteScan {
  const modulesDir = resolve(import.meta.dirname, '../../src/modules');
  const registered = new Set<string>();
  const authenticated = new Set<string>();

  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const full = resolve(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.endsWith('.ts')) continue;
      const text = readFileSync(full, 'utf8');
      const opRegex = /operationId:\s*'([^']+)'/g;
      let match: RegExpExecArray | null;
      while ((match = opRegex.exec(text)) !== null) {
        const operationId = match[1]!;
        registered.add(operationId);
        // Every route registration in this codebase places `preHandler:
        // requireAuth(...)` (when present) before the handler's `async (` —
        // scanning up to that boundary avoids matching the *next* route's
        // preHandler once the option object's own closing brace is behind us.
        const handlerStart = text.indexOf('async (', match.index);
        const window = handlerStart === -1 ? text.slice(match.index) : text.slice(match.index, handlerStart);
        if (window.includes('requireAuth')) authenticated.add(operationId);
      }
    }
  }
  walk(modulesDir);
  return { registered, authenticated };
}

/** Known owner-or-admin operations, cross-referenced against each owning module's ownership check (design/core-api.md §7, G-AUTH-OWNER). */
const OWNER_OR_ADMIN_OPERATIONS = new Set<PanelOperationId>([
  'pauseRecording',
  'resumeRecording',
  'stopRecording',
  'enableChannel',
  'disableChannel',
  'getRecording',
  'getRecordingMedia',
  'updateAudioControl',
  'createExport',
  'getExport',
  'cancelExport',
]);

describe('centralized operation/role/owner authorization matrix (B-43 KEEP)', () => {
  it('covers exactly the 79 panel operation ids', () => {
    expect(Object.keys(OPERATION_AUTHORIZATION).sort()).toEqual([...PANEL_OPERATION_IDS].sort());
  });

  const adminGated = adminGatedOperations();
  const { registered, authenticated } = scanRoutes();

  it.each(PANEL_OPERATION_IDS)('%s: admin gate matches openapi.yaml x-required-role', (operationId) => {
    const requirement = OPERATION_AUTHORIZATION[operationId];
    if (adminGated.has(operationId)) {
      expect(requirement).toBe('admin');
    } else {
      expect(requirement).not.toBe('admin');
    }
  });

  it.each(PANEL_OPERATION_IDS.filter((operationId) => registered.has(operationId)))(
    '%s: public vs authenticated matches whether the (already-implemented) route calls requireAuth',
    (operationId) => {
      const requirement = OPERATION_AUTHORIZATION[operationId];
      if (requirement === 'public') {
        expect(authenticated.has(operationId)).toBe(false);
      } else {
        expect(authenticated.has(operationId)).toBe(true);
      }
    },
  );

  it('tags exactly the known owner-or-admin operations', () => {
    const tagged = new Set(
      (Object.keys(OPERATION_AUTHORIZATION) as PanelOperationId[]).filter((id) => OPERATION_AUTHORIZATION[id] === 'owner-or-admin'),
    );
    expect(tagged).toEqual(OWNER_OR_ADMIN_OPERATIONS);
  });

  it('users own operations are all admin-gated', () => {
    for (const operationId of ['listUsers', 'createUser', 'updateUser', 'deleteUser', 'importUsers'] as const) {
      expect(OPERATION_AUTHORIZATION[operationId]).toBe('admin');
    }
  });
});
