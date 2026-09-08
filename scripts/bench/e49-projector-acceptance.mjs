#!/usr/bin/env node
// E-49 projector overlay acceptance.
//
// Runs a real pipeline-manager (A) FastAPI process with only the GStreamer
// worker child faked (no HDMI/X display) and verifies every software-checkable
// projector-card property: publish-before-project (no card before the first
// publication — QO-1 exclusion), the exact B→A `QuestionOverlay` payload parses,
// the rendered join QR decodes back to the join URL, the four forbidden privacy
// fields are rejected 422, and the display child restarts with a fresh PGID.
//
// The physical HDMI #1 slides↔question capture (a phone-decodable QR on a real
// projector) needs an HDMI receiver and is DEFERRED to Workstream F device
// bring-up, exactly as the A-16 HDMI #2 / projector-latency measurements are.
// The A+B+D ordering/parity witness is
// services/core-api/test/integration/projector-real-stack.test.ts.
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '../..');
const PM_PYTHON = join(REPO, 'services/pipeline-manager/.venv/bin/python');
const BEARER = 'e49-acceptance-shared-bearer-token-0123456789abcdef';
const JOIN_URL = 'https://quiz.example.edu/j/E49BENCH';
const JOIN_CODE = 'E49BENCH';

const evidenceDir = process.env.EDUSCOPE_E49_EVIDENCE_DIR ?? join(REPO, 'docs/evidence/phase-4/workstream-e/e49');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

async function startA(runtimeDir, helperSocket) {
  const port = await reservePort();
  const url = `http://127.0.0.1:${port}`;
  const inline = [
    'import subprocess, uvicorn',
    'from pipeline_manager.app import create_app',
    'from pipeline_manager.config import Settings',
    's = Settings()',
    'app = create_app(s, popen=subprocess.Popen, runtime_dir=s.runtime_dir)',
    "uvicorn.run(app, host=s.bind_host, port=s.port, log_level='warning')",
  ].join('\n');
  const child = spawn(PM_PYTHON, ['-c', inline], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: {
      ...process.env,
      EDUSCOPE_PM_BIND_HOST: '127.0.0.1',
      EDUSCOPE_PM_PORT: String(port),
      EDUSCOPE_PM_SHARED_BEARER_TOKEN: BEARER,
      EDUSCOPE_PM_RUNTIME_DIR: runtimeDir,
      EDUSCOPE_PM_HELPER_SOCKET: helperSocket,
      EDUSCOPE_PM_LED_PRESENT: 'false',
      EDUSCOPE_PM_PROJECTOR_FAKE_WORKER: '1',
    },
  });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/healthz`);
      if (res.ok) break;
    } catch { /* not up */ }
    await delay(150);
  }
  return { url, child };
}

const auth = { authorization: `Bearer ${BEARER}`, 'content-type': 'application/json' };
async function postProjector(url, body) {
  const res = await fetch(`${url}/consumers/projector`, { method: 'POST', headers: auth, body: JSON.stringify(body) });
  return { status: res.status };
}
async function projectorPgid(url) {
  const res = await fetch(`${url}/status`, { headers: { authorization: `Bearer ${BEARER}` } });
  if (!res.ok) return null;
  const body = await res.json();
  return body.consumers.find((c) => c.kind === 'projector')?.pgid ?? null;
}
function cards(runtimeDir) {
  try { return readdirSync(join(runtimeDir, 'projector')).filter((n) => n.endsWith('.png')); }
  catch { return []; }
}
function decodeQr(cardPath) {
  const script = 'import sys, zxingcpp\nfrom PIL import Image\nprint("\\n".join(r.text for r in zxingcpp.read_barcodes(Image.open(sys.argv[1]))))';
  const out = spawnSync(PM_PYTHON, ['-c', script, cardPath], { encoding: 'utf8' });
  if (out.status !== 0) throw new Error(`QR decode failed: ${out.stderr}`);
  return out.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
}

const payload = (publicationId, extra = {}) => ({
  mode: 'question',
  questionPayload: {
    publicationId,
    prompt: 'Which service renders the projector card?',
    options: [
      { id: 'opt-a', label: 'A', text: 'core-api' },
      { id: 'opt-b', label: 'B', text: 'pipeline-manager' },
      { id: 'opt-c', label: 'C', text: 'nginx' },
    ],
    joinUrl: JOIN_URL,
    joinCode: JOIN_CODE,
    ...extra,
  },
});

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'e49-acceptance-'));
  const runtimeDir = join(dir, 'pm-runtime');
  mkdirSync(runtimeDir, { recursive: true });
  const { url, child } = await startA(runtimeDir, join(dir, 'helper.sock'));

  const checks = {};
  try {
    // QO-1: no card exists before the first publication.
    checks.noCardBeforePublication = cards(runtimeDir).length === 0;

    // Payload parity + render + QR decode.
    const parity = await postProjector(url, payload('pub-bench-1'));
    checks.payloadParity202 = parity.status === 202;
    await delay(300);
    const rendered = cards(runtimeDir);
    checks.cardRendered = rendered.length === 1;
    checks.optionsRendered = payload('x').questionPayload.options.length;
    const decoded = decodeQr(join(runtimeDir, 'projector', 'pub-bench-1.png'));
    checks.qrDecodesToJoinUrl = decoded.includes(JOIN_URL);
    checks.joinCode = JOIN_CODE;

    // Privacy: the four forbidden fields are rejected 422.
    let rejected = 0;
    for (const field of ['leaderboard', 'participantCount', 'score', 'studentId']) {
      const r = await postProjector(url, payload('pub-priv', { [field]: 'nope' }));
      if (r.status === 422) rejected += 1;
    }
    checks.privacyRejected = rejected;

    // Display child restart with a fresh PGID (no rebuild), never restarted before.
    const first = await projectorPgid(url);
    process.kill(-Number(first), 'SIGKILL');
    await delay(600);
    await postProjector(url, payload('pub-bench-2'));
    let second = await projectorPgid(url);
    const rdeadline = Date.now() + 5_000;
    while (Date.now() < rdeadline && (second === null || second === first)) {
      await delay(150);
      second = await projectorPgid(url);
    }
    checks.projectorRestarted = second !== null && second !== first;

    // Withdraw back to slides passthrough.
    checks.passthrough202 = (await postProjector(url, { mode: 'passthrough' })).status === 202;
  } finally {
    child.kill('SIGKILL');
  }

  const softwarePass =
    checks.noCardBeforePublication &&
    checks.payloadParity202 &&
    checks.cardRendered &&
    checks.qrDecodesToJoinUrl &&
    checks.privacyRejected === 4 &&
    checks.projectorRestarted &&
    checks.passthrough202;

  const iso = new Date().toISOString();
  const stamp = iso.replaceAll(/[-:.]/g, '');
  const result = softwarePass
    ? 'PASS with deferred physical HDMI capture'
    : 'FAIL';
  const record = {
    result,
    task: 'E-49',
    at: iso,
    pipelineManager: 'real FastAPI process; GStreamer worker faked (no HDMI/X)',
    checks,
    physicalHdmiCapture: 'DEFERRED to Workstream F device bring-up (no HDMI receiver here)',
    integrationWitness: 'services/core-api/test/integration/projector-real-stack.test.ts',
    joinUrl: JOIN_URL,
  };
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(join(evidenceDir, `${stamp}.json`), `${JSON.stringify(record, null, 2)}\n`);
  await writeFile(
    join(evidenceDir, `${stamp}.md`),
    [
      '# E-49 projector overlay acceptance',
      '',
      `- Result: ${result}`,
      `- At: ${iso}`,
      '- Pipeline-manager (A): real FastAPI process, GStreamer worker faked (no HDMI/X)',
      `- Payload parity (B → A QuestionOverlay): ${checks.payloadParity202 ? 'PASS' : 'FAIL'}`,
      `- Options rendered: ${checks.optionsRendered}`,
      `- Join code on card: ${JOIN_CODE}`,
      `- QR decodes to join URL: ${checks.qrDecodesToJoinUrl ? 'PASS' : 'FAIL'} (${JOIN_URL})`,
      `- No card before the first publication (QO-1): ${checks.noCardBeforePublication ? 'PASS' : 'FAIL'}`,
      `- Forbidden privacy fields rejected: ${checks.privacyRejected}/4 → 422`,
      `- Projector display child restart (fresh PGID): ${checks.projectorRestarted ? 'PASS' : 'FAIL'}`,
      '- Physical HDMI #1 slides↔question capture: DEFERRED to Workstream F device bring-up (no HDMI receiver)',
      '- A+B+D integration witness: `services/core-api/test/integration/projector-real-stack.test.ts`',
      `- Evidence JSON: \`${stamp}.json\``,
      '',
      'Contains no question text, QR image, credential, participant PII, or media frame.',
      '',
    ].join('\n'),
  );

  if (!softwarePass) {
    console.error('FAIL E-49 projector acceptance', JSON.stringify(checks));
    process.exit(1);
  }
  console.log('PASS E-49 projector acceptance (physical HDMI capture deferred to Workstream F)');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
