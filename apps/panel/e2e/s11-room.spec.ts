import { expect, test, type Page } from '@playwright/test';
import { REAL_STACK_ACCOUNTS, expect as realExpect, test as realTest } from './fixtures/real-stack.js';

// Mirrors apps/panel/src/audio/use-audio-control.ts AUDIO_LOCKED_REASON.
const AUDIO_LOCKED_REASON =
  'Only the recording owner or an administrator can change audio controls right now.';

const ALL_SOURCES_ONLINE = {
  publishers: {
    usb: { state: 'online', bound: true, fps: 30, rms: null, lastError: null },
    rtsp: { state: 'online', bound: true, fps: 30, rms: null, lastError: null },
    rtsp2: { state: 'online', bound: true, fps: 30, rms: null, lastError: null },
    audio: { state: 'online', bound: true, fps: null, rms: 0.4, lastError: null },
  },
  consumers: [{ id: 'record:00000001', state: 'running', pgid: 7101 }],
} as const;

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Username').fill('a.perera');
  await page.getByLabel('Password').fill('correct-horse');
  await page.getByRole('button', { name: 'Log In' }).click();
  await expect(page).toHaveURL('/');
}

async function openScenarioOverlay(page: Page) {
  const hotspot = page.getByTestId('scenario-hotspot');
  const box = await hotspot.boundingBox();
  if (!box) throw new Error('scenario hotspot has no box — is the mock client active?');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(2_200);
  await page.mouse.up();
  await expect(page.getByRole('dialog', { name: /scenario/i })).toBeVisible();
}

async function expandRoom(page: Page) {
  await page.getByRole('button', { name: 'Show controls' }).click();
  await expect(page.getByRole('region', { name: 'MICROPHONE' })).toBeVisible();
}

test.describe('S-11 Room controls bar', () => {
  test('the primary room journey exposes three regions, mutes, and collapses', async ({ page }) => {
    await signIn(page);
    await expandRoom(page);
    await expect(page.getByRole('region', { name: 'MICROPHONE' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'POWER' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'NOT CONNECTED' })).toBeVisible();
    const mic = page.getByRole('region', { name: 'MICROPHONE' });
    await mic.getByRole('switch', { name: 'Lecturer Mic' }).click();
    await expect(page.getByTestId('mic-master-state')).toHaveText('Muted');
    await page.getByRole('button', { name: 'Collapse' }).click();
    await expect(page.getByRole('region', { name: 'MICROPHONE' })).toHaveCount(0);
  });

  test('a failed mute keeps Live truth and names the failed direction', async ({ page }) => {
    await signIn(page);
    await openScenarioOverlay(page);
    await page.getByRole('checkbox', { name: 'Mic changes fail to apply' }).check();
    await page.getByRole('button', { name: /close scenarios/i }).click();
    await expandRoom(page);
    const mic = page.getByRole('region', { name: 'MICROPHONE' });
    await mic.getByRole('switch', { name: 'Lecturer Mic' }).click();
    await expect(mic.getByRole('switch', { name: 'Lecturer Mic' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('mic-master-state')).toHaveText("Still live — the mute didn't apply.");
  });

  test('the expanded idle bar stays within its 168px envelope', async ({ page }) => {
    await signIn(page);
    await expandRoom(page);
    const box = await page.getByTestId('room-controls-bar').boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeLessThanOrEqual(168);
  });

  test('the expanded bar has exactly four tab stops', async ({ page }) => {
    await signIn(page);
    await expandRoom(page);
    await page.getByRole('button', { name: 'Advanced' }).focus();
    const labels: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      labels.push(await page.evaluate(() => {
        const element = document.activeElement as HTMLElement;
        return element.getAttribute('aria-label') ?? element.textContent?.trim() ?? '';
      }));
      await page.keyboard.press('Tab');
    }
    expect(labels).toEqual(['Advanced', 'Collapse', 'Lecturer Mic', 'Power off']);
    await expect(page.getByTestId('room-controls-bar').locator(':focus')).toHaveCount(0);
  });

  test('S-11 and S-09 read and update one shared microphone truth', async ({ page }) => {
    await signIn(page);
    await expandRoom(page);
    const room = page.getByRole('region', { name: 'MICROPHONE' });
    await room.getByRole('switch', { name: 'Lecturer Mic' }).click();
    await expect(page.getByTestId('mic-master-state')).toHaveText('Muted');

    await page.getByRole('button', { name: 'Show sources' }).click();
    const sources = page.getByTestId('mic-row');
    await expect(sources.getByTestId('mic-state')).toHaveText('Muted');
    await sources.getByRole('switch', { name: 'Lecturer Mic' }).click();
    await expect(sources.getByTestId('mic-state')).toHaveText('Live');
    await expect(page.getByTestId('mic-master-state')).toHaveText('Live');
  });

  test('the not-connected region makes no state claims', async ({ page }) => {
    await signIn(page);
    await expandRoom(page);
    const text = await page.getByRole('region', { name: 'NOT CONNECTED' }).innerText();
    expect(text).not.toMatch(/\b(on|off|lowered|raised|\d+%|\d+°C)\b/i);
  });
});

realTest.describe('S-11 Room controls bar — real', () => {
  realTest(
    'real: non-owner mute is server-refused, admin mute reaches applied truth, and hardware placeholders make zero calls',
    { annotation: { type: 'adapter', description: 'real' } },
    async ({ page, realStack }) => {
      realTest.setTimeout(90_000);

      await page.route('**/config.json', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            apiBaseUrl: realStack.coreBaseUrl,
            quizBaseUrl: realStack.quizTlsBaseUrl ?? realStack.quizBaseUrl,
            environment: 'integration',
            adapters: { default: 'real', overrides: {} },
          }),
        });
      });

      const coreOrigin = new URL(realStack.coreBaseUrl).origin;
      const mutatingCalls: { method: string; path: string }[] = [];
      page.on('request', (request) => {
        const method = request.method();
        if (method === 'GET' || method === 'OPTIONS') return;
        if (!request.url().startsWith(coreOrigin)) return;
        mutatingCalls.push({ method, path: new URL(request.url()).pathname });
      });

      // The owner (e06-lecturer) opens a real, active recording out of band so
      // the browser user is a genuine non-owner of a live session.
      await realStack.control('core.pm.status', { status: ALL_SOURCES_ONLINE });
      const ownerRes = await fetch(`${realStack.coreBaseUrl}/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...REAL_STACK_ACCOUNTS.lecturer, client: 'panel' }),
      });
      const { tokens: ownerTokens } = await ownerRes.json() as { tokens: { accessToken: string } };
      const startRes = await fetch(`${realStack.coreBaseUrl}/recording/start`, {
        method: 'POST', headers: { authorization: `Bearer ${ownerTokens.accessToken}` },
      });
      realExpect(startRes.status).toBe(202);
      await realStack.control('core.pm.publish', {
        event: 'evt.pm.consumer.running', data: { consumerId: 'record:00000001', pgid: 7101 },
      });
      await realExpect
        .poll(async () => (await realStack.recordingAudit()).recordStarts)
        .toBeGreaterThanOrEqual(1);

      // ---- Non-owner: the panel locks the control and the server refuses ----
      await page.goto('/login');
      await page.getByLabel('Username').fill(REAL_STACK_ACCOUNTS.other.username);
      await page.getByLabel('Password').fill(REAL_STACK_ACCOUNTS.other.password);
      await page.getByRole('button', { name: 'Log In' }).click();
      await realExpect(page.locator('[data-screen="S-06"]')).toBeVisible();
      await page.getByRole('button', { name: 'Show controls' }).click();
      const nonOwnerMic = page.getByRole('region', { name: 'MICROPHONE' });
      await realExpect(nonOwnerMic.getByRole('switch', { name: 'Lecturer Mic' })).toBeDisabled();
      await realExpect(page.getByTestId('mic-master-state')).toHaveText(AUDIO_LOCKED_REASON);

      // Server authority (defense in depth): a direct non-owner mute is 403.
      const otherRes = await fetch(`${realStack.coreBaseUrl}/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...REAL_STACK_ACCOUNTS.other, client: 'panel' }),
      });
      const { tokens: otherTokens } = await otherRes.json() as { tokens: { accessToken: string } };
      const refused = await fetch(`${realStack.coreBaseUrl}/audio/controls/mic-lecturer`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${otherTokens.accessToken}` },
        body: JSON.stringify({ muted: true }),
      });
      realExpect(refused.status).toBe(403);
      realExpect((await refused.json() as { code: string }).code).toBe('not-authorized');

      // ---- Admin: mute is permitted and reaches real applied mixer truth ----
      await page.goto('/login');
      await page.getByLabel('Username').fill(REAL_STACK_ACCOUNTS.admin.username);
      await page.getByLabel('Password').fill(REAL_STACK_ACCOUNTS.admin.password);
      await page.getByRole('button', { name: 'Log In' }).click();
      await realExpect(page.locator('[data-screen="S-06"]')).toBeVisible();
      await page.getByRole('button', { name: 'Show controls' }).click();
      const adminMic = page.getByRole('region', { name: 'MICROPHONE' });
      const adminSwitch = adminMic.getByRole('switch', { name: 'Lecturer Mic' });
      await realExpect(adminSwitch).toBeEnabled();
      await adminSwitch.click();
      await realExpect(page.getByTestId('mic-master-state')).toHaveText('Muted', { timeout: 15_000 });

      // ---- Room hardware placeholders are inert: zero calls, no endpoint ----
      const beforePlaceholders = mutatingCalls.length;
      for (const name of ['Projector', 'Lights', 'Air conditioning']) {
        await page.getByRole('region', { name: 'NOT CONNECTED' }).getByText(
          name === 'Air conditioning' ? 'A/C' : name, { exact: true },
        ).click();
      }
      await page.waitForTimeout(500);
      realExpect(mutatingCalls.length, 'placeholders issued no operation/HTTP call').toBe(beforePlaceholders);

      // The only mixer write the browser ever made was updateAudioControl, and
      // no room-hardware endpoint was ever contacted.
      const audioWrites = mutatingCalls.filter((call) => /\/audio\/controls\//.test(call.path));
      realExpect(audioWrites.every((call) => call.method === 'PUT')).toBe(true);
      realExpect(audioWrites.length).toBeGreaterThanOrEqual(1);
      realExpect(
        mutatingCalls.every((call) => !/light|projector|screen|speaker|hvac|air|room-hardware/i.test(call.path)),
        'no room-hardware endpoint exists',
      ).toBe(true);
    },
  );
});
