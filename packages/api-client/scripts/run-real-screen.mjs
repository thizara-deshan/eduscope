#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { run, startStack, stopStack } from './gate-dual-adapter.mjs';

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

export function declaresRealWitness(source) {
  return /annotation\s*:\s*\{[\s\S]*?type\s*:\s*['"]adapter['"][\s\S]*?description\s*:\s*['"]real['"]/m.test(source)
    || /EDUSCOPE_E2E_ADAPTER[\s\S]{0,120}real/m.test(source);
}

/**
 * A panel screen whose real witness exercises the quiz service (B→D
 * publications, responses, leaderboard, sessions) needs the full B+D stack,
 * not E-06's Docker-less panel-only stack. Such a spec opts in with the
 * `eduscope:needs-real-d` sentinel; the default panel run stays D-free and
 * runnable on boards without Docker.
 */
export function declaresRealD(source) {
  return /eduscope:needs-real-d/.test(source);
}

async function main() {
  const [app, stem] = process.argv.slice(2);
  if ((app !== 'panel' && app !== 'quiz') || !stem || !/^[a-z0-9-]+$/.test(stem)) {
    throw new Error('usage: run-real-screen.mjs <panel|quiz> <spec-stem>');
  }
  const specRelative = `apps/${app}/e2e/${stem}.spec.ts`;
  const source = await readFile(new URL(`../../../${specRelative}`, import.meta.url), 'utf8');
  if (!declaresRealWitness(source)) {
    throw new Error(`${specRelative} does not declare a real adapter witness`);
  }

  const panelOnly = app === 'panel' && !declaresRealD(source);
  const stack = await startStack({ env: panelOnly ? { EDUSCOPE_PANEL_ONLY: '1' } : {} });
  let failure;
  try {
    await run(pnpm, [
      // No `--` before the spec path: this pnpm version forwards it literally
      // to Playwright's CLI, which then treats it as a filter reset and runs
      // the entire suite instead of just this spec.
      '--filter', `@eduscope/${app}`, 'e2e', `e2e/${stem}.spec.ts`, '--grep', 'real:',
    ], {
      env: {
        EDUSCOPE_E2E_ADAPTER: 'real',
        EDUSCOPE_REAL_STACK_DESCRIPTOR: JSON.stringify(stack.descriptor),
        NODE_TLS_REJECT_UNAUTHORIZED: '0',
        ...(process.env.EDUSCOPE_PLAYWRIGHT_CHROMIUM_PATH
          ? {}
          : existsSync('/usr/bin/chromium-browser')
            ? { EDUSCOPE_PLAYWRIGHT_CHROMIUM_PATH: '/usr/bin/chromium-browser' }
            : {}),
      },
    });
  } catch (error) {
    failure = error;
  } finally {
    await stopStack(stack.child);
  }
  if (failure) throw failure;
  process.stdout.write(`PASS real:${stem}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
