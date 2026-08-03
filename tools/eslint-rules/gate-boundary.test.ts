import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const VIOLATION = resolve(root, 'apps/panel/src/__gate__/direct-fetch.ts');
const CONTROL = resolve(root, 'packages/api-client/src/__gate__/direct-fetch.ts');

const CODE = `export async function load(): Promise<unknown> {
  const response = await fetch('/api/v1/recording/state');
  return response.json();
}
`;

function write(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, CODE, 'utf8');
}

function lintExitCode(): number {
  try {
    execFileSync('pnpm', ['lint'], { cwd: root, stdio: 'pipe', shell: true });
    return 0;
  } catch (e) {
    return (e as { status?: number }).status ?? 1;
  }
}

afterEach(() => {
  for (const p of [VIOLATION, CONTROL]) {
    if (existsSync(p)) rmSync(dirname(p), { recursive: true, force: true });
  }
});

// Each assertion shells out to a full `pnpm lint` across the workspace
// (~8-9s observed here) — well past vitest's 5000ms default, same class of
// cold-start cost as Task 17's ESLint#lintText finding. Bumped explicitly.
describe('GATE 3 — the boundary rule fails the build', () => {
  it('3a: pnpm lint is green with no violation present', () => {
    expect(lintExitCode(), 'the repo must lint clean before the gate means anything')
      .toBe(0);
  }, 20_000);

  it('3b: a direct fetch in apps/panel makes pnpm lint exit non-zero', () => {
    write(VIOLATION);
    expect(
      lintExitCode(),
      'a component calling fetch() must FAIL the build (frontend-conventions §1)',
    ).not.toBe(0);
  }, 20_000);

  it('3c: the same file inside packages/api-client keeps lint green', () => {
    write(CONTROL);
    expect(
      lintExitCode(),
      'packages/api-client IS the network boundary and must stay unrestricted',
    ).toBe(0);
  }, 20_000);
});
