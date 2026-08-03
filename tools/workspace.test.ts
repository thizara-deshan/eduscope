import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('workspace foundation', () => {
  it('declares both workspace globs', () => {
    const ws = read('pnpm-workspace.yaml');
    expect(ws).toContain('packages/*');
    expect(ws).toContain('apps/*');
  });

  it('pins the Node floor in .nvmrc and engines', () => {
    // 22.13.0, not the plan's original 22.11.0. Two CI failures pinned
    // this down: vite@7.3.6 needs >=22.12.0 (from the plan's own "Vite
    // >= 7" floor), then eslint-visitor-keys@5.0.1 (a transitive dep of
    // eslint@9) needs ^22.13.0 specifically — 22.12.0 doesn't satisfy
    // that range. Verified against every installed package's engines.node
    // field so this doesn't need a third round; human-approved, 2026-08-03.
    expect(read('.nvmrc').trim()).toBe('22.13.0');
    const pkg = JSON.parse(read('package.json')) as { engines?: { node?: string } };
    expect(pkg.engines?.node).toBe('>=22.13');
  });

  it('turns on the strictness the plan depends on', () => {
    const base = JSON.parse(read('tsconfig.base.json')) as {
      compilerOptions: Record<string, unknown>;
    };
    expect(base.compilerOptions.strict).toBe(true);
    expect(base.compilerOptions.noUncheckedIndexedAccess).toBe(true);
    expect(base.compilerOptions.verbatimModuleSyntax).toBe(true);
  });

  it('exposes the five root scripts CI runs', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    for (const s of ['typecheck', 'lint', 'test', 'build', 'e2e']) {
      expect(pkg.scripts[s], `missing root script: ${s}`).toBeTruthy();
    }
  });

  it('gives the app test projects a DOM environment', () => {
    const ws = read('vitest.workspace.ts');
    expect(ws).toContain('jsdom');
    expect(ws).toContain('apps/panel');
    expect(ws).toContain('apps/quiz');
  });

  it('lints from task 1 — the root script must not be dead for 16 tasks', () => {
    const config = read('eslint.config.js');
    // The a11y and hooks guardrails are cheapest to add before any screen exists.
    expect(config).toContain('react-hooks');
    expect(config).toContain('jsx-a11y');
  });
});
