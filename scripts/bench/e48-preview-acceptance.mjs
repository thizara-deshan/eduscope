#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import playwright from '../../apps/panel/node_modules/@playwright/test/index.js';
const { chromium } = playwright;

const panelUrl = process.env.EDUSCOPE_PANEL_URL ?? 'http://127.0.0.1';
const evidenceDir = process.env.EDUSCOPE_E48_EVIDENCE_DIR;
const username = process.env.EDUSCOPE_E48_USERNAME ?? 'e48-lecturer';
const password = process.env.EDUSCOPE_E48_PASSWORD ?? 'E48LecturerPass1!';
const pmUrl = process.env.EDUSCOPE_PM_URL ?? 'http://127.0.0.1:8091';
const pmToken = process.env.EDUSCOPE_PM_TOKEN ?? '0123456789abcdef0123456789abcdef';
if (!evidenceDir) throw new Error('EDUSCOPE_E48_EVIDENCE_DIR is required');

const auth = { authorization: `Bearer ${pmToken}` };
async function pm(path, init = {}) {
  const response = await fetch(`${pmUrl}${path}`, { ...init, headers: { ...auth, ...(init.headers ?? {}) } });
  if (!response.ok) throw new Error(`pipeline-manager ${path} returned ${response.status}`);
  return response.status === 204 || response.headers.get('content-length') === '0' ? null : response.json();
}
async function waitForPublisher(publisherId, state, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await pm('/status');
    if (status.publishers[publisherId]?.state === state) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${publisherId} publisher did not become ${state}`);
}
const digest = (bytes) => createHash('sha256').update(Buffer.from(bytes)).digest('hex');
const iso = new Date().toISOString();
const stamp = iso.replaceAll(/[-:.]/g, '').replace('Z', 'Z');
const measurements = [];
// Temporary board-room constraint approved for this run: the HDMI source is a
// valid real feed but cannot currently be made to display moving content.
const motionWaiver = { source: 'presentation', reason: 'static HDMI content; operator-approved waiver' };
const browser = await chromium.launch({ executablePath: process.env.EDUSCOPE_PLAYWRIGHT_CHROMIUM_PATH ?? '/usr/bin/chromium-browser' });
const page = await browser.newPage();
const jpegRequests = [];
const forbidden = [];
page.on('request', (request) => {
  const url = request.url();
  if (/\/sources\/[^/]+\/preview\.jpg/.test(url)) jpegRequests.push({ url: url.replace(/\?.*$/, ''), at: Date.now() });
  if (/\/ws\/preview|sdp|ice/i.test(url)) forbidden.push(url);
});
page.on('websocket', (socket) => { if (/preview/i.test(socket.url())) forbidden.push(socket.url()); });

async function frameDigest(locator) {
  return digest(await locator.evaluate(async (image) => Array.from(new Uint8Array(await (await fetch(image.src)).arrayBuffer()))));
}

let recordingStarted = false;
try {
  const before = await pm('/status');
  await page.goto(`${panelUrl}/login`);
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log In' }).click();
  await page.waitForURL(`${panelUrl}/`);
  const recordingControl = page.getByRole('button', { name: /^(Start Recording|Pause)$/ }).first();
  await recordingControl.waitFor({ state: 'visible', timeout: 15_000 });
  if (await recordingControl.getAttribute('aria-label') === 'Start Recording' || await recordingControl.textContent() === 'Start Recording') {
    const start = page.getByRole('button', { name: 'Start Recording' });
    await start.click();
    await page.getByRole('button', { name: 'Pause' }).waitFor({ state: 'visible', timeout: 15_000 });
    recordingStarted = true;
  }
  await page.getByRole('button', { name: 'Show sources' }).click();

  for (const [role, label] of [['presentation', 'PC'], ['lecturer-cam', 'CAM 1'], ['students-cam', 'CAM 2']]) {
    const tile = page.locator(`[data-testid="source-tile"][data-role="${role}"]`);
    await tile.waitFor({ state: 'visible' });
    const openedAt = Date.now();
    await tile.click();
    const dialog = page.getByRole('dialog', { name: `${label} preview` });
    const frame = dialog.getByTestId('preview-frame');
    await frame.waitFor({ state: 'visible', timeout: 1_000 });
    const firstImageMs = Date.now() - openedAt;
    const firstSrc = await frame.getAttribute('src');
    const firstDigest = await frameDigest(frame);
    await page.waitForFunction((src) => document.querySelector('[data-testid="preview-frame"]')?.getAttribute('src') !== src, firstSrc, { timeout: 2_000 });
    const secondDigest = await frameDigest(frame);
    const dimensions = await frame.evaluate((image) => ({ width: image.naturalWidth, height: image.naturalHeight }));
    const changing = firstDigest !== secondDigest;
    if (firstImageMs >= 1_000 || (!changing && role !== motionWaiver.source) || dimensions.width > 480 || dimensions.height > 270) {
      throw new Error(`invalid ${role} preview measurements: firstImageMs=${firstImageMs}, distinct=${String(firstDigest !== secondDigest)}, dimensions=${dimensions.width}x${dimensions.height}`);
    }
    measurements.push({ role, firstImageMs, dimensions, changing, digests: [firstDigest, secondDigest] });
    await page.getByRole('button', { name: 'Close preview' }).click();
    const count = jpegRequests.length;
    await page.waitForTimeout(1_200);
    if (jpegRequests.length !== count) throw new Error(`${role} continued polling after close`);
  }

  // Source-loss/recovery while retaining the last successful frame.
  await page.locator('[data-testid="source-tile"][data-role="presentation"]').click();
  await page.getByTestId('preview-frame').waitFor({ state: 'visible', timeout: 1_000 });
  await pm('/publishers/usb/stop', { method: 'POST' });
  await page.getByText('STALE', { exact: true }).waitFor({ state: 'visible', timeout: 5_000 });
  if (!await page.getByTestId('preview-frame').isVisible()) throw new Error('stale frame was not retained');
  await pm('/publishers/usb/start', { method: 'POST' });
  await waitForPublisher('usb', 'online');
  // A shmsrc loss ends the composite JPEG worker; restarting the fixed-id
  // auxiliary consumer reconnects all branches after the source is online.
  await pm('/consumers/thumbnails/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  await page.getByText('LIVE', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });

  // Thumbnail-only outage/recovery; no signaling reconnect is permitted.
  await pm('/consumers/thumbnails/stop', { method: 'POST' });
  await page.getByText('STALE', { exact: true }).waitFor({ state: 'visible', timeout: 5_000 });
  await pm('/consumers/thumbnails/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  await page.getByText('LIVE', { exact: true }).waitFor({ state: 'visible', timeout: 5_000 });
  await page.getByRole('button', { name: 'Close preview' }).click();

  const after = await pm('/status');
  if (forbidden.length) throw new Error(`forbidden preview signaling observed (${forbidden.length})`);
  const intervals = jpegRequests.slice(1).map((request, index) => request.at - jpegRequests[index].at).filter((ms) => ms < 2_000);
  const evidence = {
    result: 'PASS', task: 'E-48', at: iso, panelUrl, measurements,
    jpegRequestCount: jpegRequests.length, cadenceMs: intervals,
    forbiddenPreviewSignaling: 0,
    waiver: motionWaiver,
    processes: { before: before.consumers, after: after.consumers },
    publishers: { before: before.publishers, after: after.publishers },
  };
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(`${evidenceDir}/${stamp}.json`, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  await writeFile(`${evidenceDir}/${stamp}.md`, `# E-48 real JPEG preview acceptance\n\n- Result: PASS with approved presentation-motion waiver\n- At: ${iso}\n- Sources: ${measurements.map((item) => item.role).join(', ')}\n- Waiver: ${motionWaiver.reason}\n- JPEG requests: ${jpegRequests.length}\n- Forbidden signaling: 0\n- Evidence JSON: \`${stamp}.json\`\n`, { mode: 0o600 });
  console.log('PASS E-48 real JPEG preview acceptance');
} finally {
  if (recordingStarted) {
    try { await page.getByRole('button', { name: 'Stop' }).click({ timeout: 2_000 }); } catch { /* the Stop control may already be gone */ }
  }
  await browser.close();
}
