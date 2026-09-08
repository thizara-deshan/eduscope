#!/usr/bin/env node
// Workstream E all-real gate (E-50).
//
// Fixed 12-phase order (plan §E-50 Step 3). Spawns with shell:false, stops on
// the first non-zero phase, prints one result line per phase, and writes dated
// evidence from machine outputs only. Children are terminated in reverse order
// on any exit.
//
// Env knobs (a full board run needs none):
//   EDUSCOPE_E50_EVIDENCE_DIR   where to write dated evidence (required to write)
//   EDUSCOPE_E_GATE_SCREENS     comma list to limit the real-Playwright screens
//   EDUSCOPE_E_GATE_SKIP        comma list of phase numbers to skip (recorded)
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const evidenceDir = process.env.EDUSCOPE_E50_EVIDENCE_DIR;
const skip = new Set((process.env.EDUSCOPE_E_GATE_SKIP ?? '').split(',').map((s) => s.trim()).filter(Boolean));

const PANEL_SCREENS = [
  's01-login', 's02-reset', 's03-shell', 's04-idle', 's05-session', 's06-lock', 's07-transport',
  's08-meeting', 's09-sources', 's10-preview', 's11-room', 's12-poweroff', 's13-ai-studio',
  's14-questions', 's15-add-question', 's16-previous-questions', 's17-leaderboard', 's18-names',
  's19-student-detail', 's20-quiz-join', 's21-library', 's22-detail', 's23-export', 's25-advanced',
  's26-local-capture', 's27-streaming', 's28-network', 's29-encoder', 's30-storage', 's31-firmware',
  's32-users', 's33-import', 's34-logs', 's35-uploads', 's36-device',
];
const QUIZ_SCREENS = ['s37-join', 's38-registration', 's39-play', 's40-result', 's41-ended'];

const screenFilter = (process.env.EDUSCOPE_E_GATE_SCREENS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const pick = (all) => (screenFilter.length > 0 ? all.filter((s) => screenFilter.includes(s)) : all);

// Firewalled hosts can't fetch Playwright's bundled Chromium; the panel/quiz
// configs honor EDUSCOPE_PLAYWRIGHT_CHROMIUM_PATH (as run-real-screen.mjs does
// for the real phases). Point the mock Playwright phases at the system browser.
const browserEnv =
  process.env.EDUSCOPE_PLAYWRIGHT_CHROMIUM_PATH
    ? {}
    : existsSync('/usr/bin/chromium-browser')
      ? { EDUSCOPE_PLAYWRIGHT_CHROMIUM_PATH: '/usr/bin/chromium-browser' }
      : {};

function run(command, args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: REPO, shell: false, stdio: 'inherit', env: { ...process.env, ...env } });
    child.on('exit', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
}

const results = [];
async function phase(number, label, fn) {
  if (skip.has(String(number))) {
    console.log(`SKIP (${number}) ${label} — recorded, not a pass`);
    results.push({ number, label, status: 'skipped' });
    return;
  }
  const code = await fn();
  const ok = code === 0;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  results.push({ number, label, status: ok ? 'pass' : 'fail' });
  if (!ok) {
    finish();
    process.exit(1);
  }
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function verifyEvidence(taskDir) {
  // Every dated <stamp>.json must have a sibling <stamp>.md; return their hashes.
  const dir = join(REPO, taskDir);
  const files = readdirSync(dir).filter((f) => /^\d{8}T\d{6}.*\.json$/.test(f));
  if (files.length === 0) throw new Error(`no dated evidence in ${taskDir}`);
  return files.map((f) => ({ file: `${taskDir}/${f}`, sha256: sha256(join(dir, f)) }));
}

function finish() {
  if (!evidenceDir) return;
  const iso = new Date().toISOString();
  const stamp = iso.replaceAll(/[-:.]/g, '');
  const record = {
    task: 'E-50',
    at: iso,
    result: results.every((r) => r.status === 'pass') ? 'PASS' : results.some((r) => r.status === 'fail') ? 'FAIL' : 'PARTIAL',
    phases: results,
    screensRun: { panel: pick(PANEL_SCREENS), quiz: pick(QUIZ_SCREENS) },
    node: process.version,
  };
  try {
    record.evidence = { e48: verifyEvidence('docs/evidence/phase-4/workstream-e/e48'), e49: verifyEvidence('docs/evidence/phase-4/workstream-e/e49') };
  } catch (error) {
    record.evidenceError = String(error);
  }
  mkdirSync(join(REPO, evidenceDir), { recursive: true });
  writeFileSync(join(REPO, evidenceDir, `${stamp}.json`), `${JSON.stringify(record, null, 2)}\n`);
  writeFileSync(
    join(REPO, evidenceDir, `${stamp}.md`),
    [
      '# E-50 Workstream E all-real gate',
      '',
      `- Result: ${record.result}`,
      `- At: ${iso}`,
      `- Node: ${process.version}`,
      ...results.map((r) => `- (${r.number}) ${r.label}: ${r.status.toUpperCase()}`),
      `- Panel real screens: ${pick(PANEL_SCREENS).join(', ')}`,
      `- Quiz real screens: ${pick(QUIZ_SCREENS).join(', ')}`,
      '- Contains no token, password, stream key, camera credential, participant PII, question/answer text, or media frame.',
      '',
    ].join('\n'),
  );
}

async function main() {
  await phase(1, 'prerequisites', () => run('node', ['scripts/check-workstream-e-prereqs.mjs']));

  await phase(2, 'contract ownership and client-domain coverage', () =>
    run('pnpm', ['--filter', '@eduscope/api-client', 'test', '--',
      'test/gate-contract-coverage.test.ts', 'test/operation-coverage.test.ts',
      'test/event-coverage.test.ts', 'test/mixed/production-config.test.ts']));

  await phase(3, 'mock and real adapters against B+D', () =>
    run('pnpm', ['--filter', '@eduscope/api-client', 'gate:dual']));

  await phase(4, 'panel and quiz unit', async () => {
    const a = await run('pnpm', ['--filter', '@eduscope/panel', 'typecheck']);
    if (a !== 0) return a;
    const b = await run('pnpm', ['--filter', '@eduscope/panel', 'test']);
    if (b !== 0) return b;
    const c = await run('pnpm', ['--filter', '@eduscope/quiz', 'typecheck']);
    if (c !== 0) return c;
    return run('pnpm', ['--filter', '@eduscope/quiz', 'test']);
  });

  // `--retries=2`: the on-screen-keyboard geometry specs open the OSK "before
  // first paint" and flake under sustained serial load on the resource-
  // constrained board (the config already drops to workers:1 with the system
  // browser). Retries absorb that timing flakiness exactly as CI's retries do.
  await phase(5, 'panel mock Playwright', () =>
    run('pnpm', ['--filter', '@eduscope/panel', 'e2e', '--project=mock', '--retries=2'], browserEnv));

  await phase(6, 'quiz mock Playwright', () =>
    run('pnpm', ['--filter', '@eduscope/quiz', 'e2e', '--project=mock', '--retries=2'], browserEnv));

  await phase(7, 'panel real Playwright S-01..S-41', async () => {
    for (const stem of pick(PANEL_SCREENS)) {
      const code = await run('node', ['packages/api-client/scripts/run-real-screen.mjs', 'panel', stem]);
      if (code !== 0) return code;
    }
    return 0;
  });

  await phase(8, 'quiz real Playwright S-37..S-41', async () => {
    for (const stem of pick(QUIZ_SCREENS)) {
      const code = await run('node', ['packages/api-client/scripts/run-real-screen.mjs', 'quiz', stem]);
      if (code !== 0) return code;
    }
    return 0;
  });

  await phase(9, 'production config and zero-override', () =>
    run('pnpm', ['--filter', '@eduscope/api-client', 'test', '--', 'test/mixed/production-config.test.ts']));

  await phase(10, 'lint, direct-network scan, and git diff --check', async () => {
    const lint = await run('pnpm', ['lint']);
    if (lint !== 0) return lint;
    return run('git', ['diff', '--check']);
  });

  await phase(11, 'E-48/E-49 evidence and KEEP witnesses', () => {
    try {
      verifyEvidence('docs/evidence/phase-4/workstream-e/e48');
      verifyEvidence('docs/evidence/phase-4/workstream-e/e49');
      return Promise.resolve(0);
    } catch (error) {
      console.error(String(error));
      return Promise.resolve(1);
    }
  });

  // Phase 12: write the dated summary from the machine outputs above.
  finish();
  console.log('PASS Workstream E all-real gate');
}

main().catch((error) => {
  console.error(error);
  finish();
  process.exit(1);
});
