import { execFile } from 'node:child_process';
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

function lint(): Promise<{ code: number; text: string }> {
  return new Promise((resolveLint) => {
    execFile('pnpm', ['lint'], { cwd: root }, (error, stdout) => {
      resolveLint({ code: error ? 1 : 0, text: stdout.toString() });
    });
  });
}

const lintExitCode = async (): Promise<number> => (await lint()).code;

afterEach(() => {
  for (const p of [VIOLATION, CONTROL]) {
    if (existsSync(p)) rmSync(dirname(p), { recursive: true, force: true });
  }
});

// Each assertion shells out to a full `pnpm lint` across the workspace
// (~15s observed on the deployment device) — well past vitest's 5000ms
// default, and slower under the full parallel workspace suite. Keep enough
// headroom for the device gate without weakening any assertion.
describe('GATE 3 — the boundary rule fails the build', () => {
  it('3a: pnpm lint is green with no violation present', async () => {
    expect(await lintExitCode(), 'the repo must lint clean before the gate means anything')
      .toBe(0);
  }, 60_000);

  it('3b: a direct fetch in apps/panel makes pnpm lint exit non-zero', async () => {
    write(VIOLATION);
    const { code, text } = await lint();
    expect(code, 'a component calling fetch() must FAIL the build (frontend-conventions §1)')
      .not.toBe(0);
    // Asserting the exit code alone is not enough: it passes even with the
    // boundary block deleted, as long as anything ELSE in the repo happens to
    // be lint-dirty. Pin the failure to this rule and this file.
    expect(text, 'lint failed, but not because of the boundary rule')
      .toContain('no-restricted-globals');
    expect(text, 'lint failed, but not on the gate fixture').toMatch(/__gate__/);
  }, 60_000);

  it('3c: the same file inside packages/api-client keeps lint green', async () => {
    write(CONTROL);
    expect(
      await lintExitCode(),
      'packages/api-client IS the network boundary and must stay unrestricted',
    ).toBe(0);
  }, 60_000);
});
