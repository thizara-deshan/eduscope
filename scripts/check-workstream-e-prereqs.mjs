#!/usr/bin/env node
// Read-only Workstream E prerequisite checker.
//
// Encodes the AMENDED criteria from the plan's
//   "Prerequisite gate — re-baselined by the prerequisite owner (2026-09-04)"
// section of
//   docs/plans/integration/workstream-e-real-adapters-and-screen-swap.md
//
// It NEVER manufactures evidence and NEVER invokes a privileged command. It
// only reads files already committed to the tree. It rejects templates,
// `NOT RUN` markers, missing dated paths, and missing reviewer-ack text.
//
// Amended disposition (2026-09-04):
//   HARD-REQUIRED local witnesses (STOP if missing/invalid):
//     A-15  dated non-template bench evidence (PASS, no NOT RUN)
//     A-16  APPROVED EXCEPTION record (CPU-headroom exception; HDMI#2 mic +
//           projector latency deferred to Workstream F) — no NOT RUN
//     C-10  dated >=90-minute (>=5400s) PASS soak evidence
//     D-09  200-client load evidence with 0 privacy leaks
//     B-38  green `gate:core-api` run evidence (PASS, exit 0, no NOT RUN)
//     ACKs  reviewer acknowledgement text for the D and E master-plan gate flags
//   EXPLICITLY DEFERRED (documented, not a silent skip; not blocking):
//     D-08  needs Docker + PostgreSQL Testcontainers (unavailable on this board)
//     D-10  campus packaging/staging (needs on-prem server/DNS/TLS)
//     D-11  quiz workstream gate (same campus infra)
//
// Exit 0 and print `PASS workstream-e prerequisites` only when every
// hard-required witness passes. Otherwise exit 1 with named missing items.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const pass = [];
const fail = [];
const deferred = [];

const abs = (...p) => join(ROOT, ...p);
const readText = (p) => readFileSync(abs(p), 'utf8');
const hasNotRun = (text) => /\bNOT RUN\b/.test(text);

/** Return dated evidence files in `dir` matching `prefix`, excluding templates. */
function datedEvidence(dir, prefix) {
  if (!existsSync(abs(dir))) return [];
  return readdirSync(abs(dir))
    .filter(
      (name) =>
        name.startsWith(prefix) &&
        name.endsWith('.md') &&
        !name.includes('template'),
    )
    .sort();
}

// ---------------------------------------------------------------------------
// A-15 — dated publishers/record-EOS bench evidence
// ---------------------------------------------------------------------------
{
  const dir = 'services/pipeline-manager/tests/bench/evidence';
  const files = datedEvidence(dir, 'a15-');
  if (files.length === 0) {
    fail.push('A-15: no dated non-template evidence file under ' + dir);
  } else {
    const file = files[files.length - 1];
    const text = readText(join(dir, file));
    if (hasNotRun(text)) {
      fail.push(`A-15: evidence ${file} contains NOT RUN`);
    } else if (!/\bPASS\b/.test(text)) {
      fail.push(`A-15: evidence ${file} records no PASS verdict`);
    } else {
      pass.push(`A-15: ${file} (dated bench evidence, PASS)`);
    }
  }
}

// ---------------------------------------------------------------------------
// A-16 — APPROVED EXCEPTION record (not a full-bench PASS)
// ---------------------------------------------------------------------------
{
  const dir = 'services/pipeline-manager/tests/bench/evidence';
  const files = datedEvidence(dir, 'a16-');
  if (files.length === 0) {
    fail.push('A-16: no dated non-template exception record under ' + dir);
  } else {
    const file = files[files.length - 1];
    const text = readText(join(dir, file));
    if (hasNotRun(text)) {
      fail.push(`A-16: record ${file} contains NOT RUN`);
    } else if (!/APPROVED EXCEPTION/.test(text)) {
      fail.push(`A-16: record ${file} lacks the APPROVED EXCEPTION disposition`);
    } else if (!/green-lit E-01/.test(text)) {
      fail.push(
        `A-16: record ${file} lacks the prerequisite-owner E-01 sign-off`,
      );
    } else {
      pass.push(`A-16: ${file} (APPROVED EXCEPTION; HDMI#2 mic + projector deferred to F)`);
    }
  }
}

// ---------------------------------------------------------------------------
// C-10 — dated >=90-minute PASS soak evidence
// ---------------------------------------------------------------------------
{
  const base = 'docs/evidence/phase-4/workstream-c/c10';
  let runs = [];
  if (existsSync(abs(base))) {
    runs = readdirSync(abs(base))
      .filter((name) => statSync(abs(base, name)).isDirectory())
      .sort();
  }
  if (runs.length === 0) {
    fail.push('C-10: no dated soak-run directory under ' + base);
  } else {
    const run = runs[runs.length - 1];
    const summaryPath = join(base, run, 'summary.json');
    const evidencePath = join(base, run, 'evidence.md');
    if (!existsSync(abs(summaryPath))) {
      fail.push(`C-10: run ${run} is missing summary.json`);
    } else {
      let ok = true;
      try {
        const summary = JSON.parse(readText(summaryPath));
        if (summary.passed !== true) {
          fail.push(`C-10: run ${run} summary.passed is not true`);
          ok = false;
        }
        if ((summary.summary?.durationSec ?? 0) < 5400) {
          fail.push(`C-10: run ${run} durationSec < 5400 (needs >=90 min)`);
          ok = false;
        }
        if (Array.isArray(summary.failures) && summary.failures.length > 0) {
          fail.push(`C-10: run ${run} reports failures`);
          ok = false;
        }
      } catch (err) {
        fail.push(`C-10: run ${run} summary.json unparseable (${err.message})`);
        ok = false;
      }
      if (existsSync(abs(evidencePath))) {
        const ev = readText(evidencePath);
        if (hasNotRun(ev)) {
          fail.push(`C-10: run ${run} evidence.md contains NOT RUN`);
          ok = false;
        } else if (!/Status:\s*PASS/.test(ev)) {
          fail.push(`C-10: run ${run} evidence.md is not Status: PASS`);
          ok = false;
        }
      } else {
        fail.push(`C-10: run ${run} is missing evidence.md`);
        ok = false;
      }
      if (ok) pass.push(`C-10: ${run} (>=90-min soak, PASS)`);
    }
  }
}

// ---------------------------------------------------------------------------
// D-09 — 200-client load evidence, 0 privacy leaks
// ---------------------------------------------------------------------------
{
  const path = 'services/quiz-service/test/load/evidence/d09-gate.json';
  if (!existsSync(abs(path))) {
    fail.push('D-09: missing ' + path);
  } else {
    try {
      const data = JSON.parse(readText(path));
      const s = data.summary ?? {};
      if ((s.clients ?? 0) < 200) {
        fail.push('D-09: load evidence has fewer than 200 clients');
      } else if (s.privacyLeaks !== 0) {
        fail.push('D-09: load evidence reports privacy leaks');
      } else {
        pass.push(`D-09: ${s.clients} clients, 0 privacy leaks`);
      }
    } catch (err) {
      fail.push(`D-09: ${path} unparseable (${err.message})`);
    }
  }
}

// ---------------------------------------------------------------------------
// B-38 — green gate:core-api run (the only remaining hard-required witness)
// ---------------------------------------------------------------------------
{
  const dir = 'services/core-api/test/integration/evidence';
  const files = existsSync(abs(dir))
    ? readdirSync(abs(dir))
        .filter(
          (name) =>
            name.startsWith('b38-') &&
            name.endsWith('.md') &&
            !name.includes('template'),
        )
        .sort()
    : [];
  if (files.length === 0) {
    fail.push('B-38: no dated non-template gate evidence under ' + dir);
  } else {
    const file = files[files.length - 1];
    const text = readText(join(dir, file));
    if (hasNotRun(text)) {
      fail.push(`B-38: evidence ${file} contains NOT RUN`);
    } else if (!/Exit code\s*\|\s*0/.test(text)) {
      fail.push(`B-38: evidence ${file} does not record exit code 0`);
    } else if (!/PASS\s*[—-]\s*`?gate:core-api`?\s*green/.test(text)) {
      fail.push(`B-38: evidence ${file} lacks a green gate:core-api verdict`);
    } else {
      pass.push(`B-38: ${file} (gate:core-api green, exit 0)`);
    }
  }
}

// ---------------------------------------------------------------------------
// Reviewer acknowledgements — D and E master-plan gate flags
// ---------------------------------------------------------------------------
{
  const plan =
    'docs/plans/integration/workstream-e-real-adapters-and-screen-swap.md';
  if (!existsSync(abs(plan))) {
    fail.push('ACK: missing plan file ' + plan);
  } else {
    const text = readText(plan);
    const dAck = /Workstream D master-plan gate flag[^\n]*✅[^\n]*acknowledged/.test(
      text,
    );
    const eAck = /Workstream E master-plan gate flag[^\n]*✅[^\n]*acknowledged/.test(
      text,
    );
    if (!dAck) fail.push('ACK: Workstream D gate-flag acknowledgement text missing');
    if (!eAck) fail.push('ACK: Workstream E gate-flag acknowledgement text missing');
    if (dAck && eAck) pass.push('ACK: D and E master-plan gate flags acknowledged');
  }
}

// ---------------------------------------------------------------------------
// Explicitly deferred witnesses (recorded, not silently skipped)
// ---------------------------------------------------------------------------
deferred.push('D-08: deferred — needs Docker + PostgreSQL Testcontainers (unavailable on this board)');
deferred.push('D-10: deferred to campus deployment (Workstream F) — needs on-prem server/DNS/TLS');
deferred.push('D-11: deferred to campus deployment (Workstream F) — needs on-prem server/DNS/TLS');

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
console.log('Workstream E prerequisite check (amended 2026-09-04 criteria)\n');
for (const line of pass) console.log('  PASS      ' + line);
for (const line of deferred) console.log('  DEFERRED  ' + line);
for (const line of fail) console.log('  MISSING   ' + line);
console.log('');

if (fail.length > 0) {
  console.log(`FAIL workstream-e prerequisites — ${fail.length} open item(s)`);
  process.exit(1);
}
console.log('PASS workstream-e prerequisites');
process.exit(0);
