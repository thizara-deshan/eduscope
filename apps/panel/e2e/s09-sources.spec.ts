import { expect, test, type Page } from '@playwright/test';
import { REAL_STACK_ACCOUNTS, expect as realExpect, test as realTest } from './fixtures/real-stack.js';

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

async function switchScenario(page: Page, name: string) {
  await openScenarioOverlay(page);
  const radio = page.getByRole('radio', { name: new RegExp(`^${name}$`) });
  if (!(await radio.isChecked())) await radio.check();
  await page.getByRole('button', { name: /close scenarios/i }).click();
}

async function expandSources(page: Page) {
  await page.getByRole('button', { name: 'Show sources' }).click();
  await expect(page.getByTestId('source-tile')).toHaveCount(3);
}

test.describe('S-09 Sources and audio bar', () => {
  test('live sources, moving meter, gain and mute controls reflect applied truth', async ({ page }) => {
    await signIn(page);
    await expandSources(page);

    const tiles = page.getByTestId('source-tile');
    await expect(tiles).toHaveCount(3);
    expect(await tiles.evaluateAll((rows) => rows.map((row) => row.getAttribute('data-state'))))
      .toEqual(['online', 'online', 'online']);

    const meter = page.getByRole('meter', { name: 'Lecturer microphone level' });
    const firstLevel = await meter.evaluate((node) => getComputedStyle(node).getPropertyValue('--level'));
    await page.waitForTimeout(500);
    expect(await meter.evaluate((node) => getComputedStyle(node).getPropertyValue('--level')))
      .not.toBe(firstLevel);

    const percentage = page.locator('.us-srcmic__pct');
    const initial = Number((await percentage.textContent())?.replace('%', ''));
    await page.getByRole('button', { name: 'Decrease Lecturer Mic level' }).click();
    await page.getByRole('button', { name: 'Decrease Lecturer Mic level' }).click();
    await expect(percentage).toHaveText(`${initial - 10}%`);
    await page.getByRole('switch', { name: 'Lecturer Mic' }).click();
    await expect(page.getByTestId('mic-state')).toHaveText('Muted');
  });

  test('pipeline faults progress from reconnecting to no signal and microphone offline', async ({ page }) => {
    test.setTimeout(30_000);
    await signIn(page);
    await switchScenario(page, 'pipeline-crash-midway');
    await expandSources(page);

    const camera = page.locator('[data-testid="source-tile"][data-role="lecturer-cam"]');
    await expect(camera).toContainText(/reconnecting/i, { timeout: 7_000 });
    await expect(camera).toHaveAttribute('data-state', 'degraded');
    await expect(camera).toContainText('No signal', { timeout: 8_000 });
    await expect(camera).toBeDisabled();

    const mic = page.getByTestId('mic-row');
    await expect(mic).toHaveAttribute('data-state', 'offline', { timeout: 10_000 });
    await expect(mic).toContainText('No microphone signal.');
  });

  test('a failed mute keeps the actual Live state and names the failure', async ({ page }) => {
    await signIn(page);
    await openScenarioOverlay(page);
    await page.getByRole('checkbox', { name: 'Mic changes fail to apply' }).check();
    await page.getByRole('button', { name: /close scenarios/i }).click();
    await expandSources(page);

    await page.getByRole('switch', { name: 'Lecturer Mic' }).click();
    await expect(page.getByRole('switch', { name: 'Lecturer Mic' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('mic-state')).toHaveText("Still live — the mute didn't apply.");
  });

  test('collapsed health dots mirror the three expanded tile states', async ({ page }) => {
    await signIn(page);
    await expandSources(page);
    const tileStates = await page.getByTestId('source-tile')
      .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-state')));
    await page.getByRole('button', { name: 'Collapse' }).click();
    await expect(page.getByTestId('source-dot')).toHaveCount(3);
    expect(await page.getByTestId('source-dot')
      .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-state'))))
      .toEqual(tileStates);
  });

  test('audio telemetry paints without rendering React', async ({ page }) => {
    await signIn(page);
    await expandSources(page);
    const before = await page.evaluate(() => window.__renderCount ?? 0);
    await page.waitForTimeout(3_000);
    expect(await page.evaluate(() => window.__renderCount ?? 0)).toBe(before);
  });

  test('the expanded bar stays within its 154px envelope', async ({ page }) => {
    await signIn(page);
    await expandSources(page);
    const box = await page.getByTestId('sources-bar').boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeLessThanOrEqual(154);
  });
});

realTest.describe('S-09 Sources and audio bar — real', () => {
  realTest(
    'real: mic unplug suppresses meters and failed mixer readback remains authoritative',
    { annotation: { type: 'adapter', description: 'real' } },
    async ({ page, realStack }) => {
      realTest.setTimeout(75_000);
      await page.goto('/login');
      await page.getByLabel('Username').fill(REAL_STACK_ACCOUNTS.lecturer.username);
      await page.getByLabel('Password').fill(REAL_STACK_ACCOUNTS.lecturer.password);
      await page.getByRole('button', { name: 'Log In' }).click();
      await realExpect(page).toHaveURL('/');
      await page.getByRole('button', { name: 'Start Recording' }).click();
      await realExpect.poll(async () => (await realStack.processAudit()).recordStarts).toBe(1);
      await realStack.control('core.pm.publish', {
        event: 'evt.pm.consumer.running', data: { consumerId: 'record:00000001', pgid: 7101 },
      });
      await realExpect(page.locator('[data-screen="S-05"]')).toBeVisible();
      await page.getByRole('button', { name: 'Show sources' }).click();
      const meter = page.getByRole('meter', { name: 'Lecturer microphone level' });
      await realExpect(meter).toHaveAttribute('aria-valuenow', /\d+/);

      await realStack.control('core.pm.response', {
        target: 'audio', status: 200, body: {
          roleId: 'mic-lecturer', appliedGain: 0, appliedMuted: false,
          appliedState: 'failed', lastError: 'Mixer apply failed on the real peer.',
        },
      });
      await realStack.control('core.pm.status', { status: {
        publishers: {
          usb: { state: 'online', bound: true, fps: 30, rms: null, lastError: null },
          rtsp: { state: 'online', bound: true, fps: 30, rms: null, lastError: null },
          rtsp2: { state: 'online', bound: true, fps: 30, rms: null, lastError: null },
          audio: { state: 'offline', bound: true, fps: null, rms: null, lastError: 'unplugged' },
        }, consumers: [{ id: 'record:00000001', state: 'running', pgid: 7101 }],
      } });
      const mic = page.getByTestId('mic-row');
      await realExpect(mic).toHaveAttribute('data-state', 'offline', { timeout: 15_000 });
      await realExpect(meter).toHaveCSS('--level', '0');
      await realExpect(page.getByTestId('mic-state')).toHaveText('No microphone signal.');

      await realStack.control('core.pm.status', { status: {
        publishers: {
          usb: { state: 'online', bound: true, fps: 30, rms: null, lastError: null },
          rtsp: { state: 'online', bound: true, fps: 30, rms: null, lastError: null },
          rtsp2: { state: 'online', bound: true, fps: 30, rms: null, lastError: null },
          audio: { state: 'online', bound: true, fps: null, rms: 0.4, lastError: null },
        }, consumers: [{ id: 'record:00000001', state: 'running', pgid: 7101 }],
      } });
      await realExpect(mic).toHaveAttribute('data-state', 'live', { timeout: 10_000 });
      await realExpect(meter).toHaveCSS('--level', '0.4');
      await page.getByRole('switch', { name: 'Lecturer Mic' }).click();
      await realExpect(mic).toHaveAttribute('data-state', 'apply-failed');
      await realExpect(page.getByTestId('mic-state')).toHaveText("Still live — the mute didn't apply.");
      await realExpect(mic).toContainText('Mixer apply failed on the real peer.');
      const audit = await realStack.processAudit();
      realExpect(audit.recordStarts).toBe(1);
      realExpect(audit.processEvents).toEqual([
        { consumerId: 'record:00000001', pgid: 7101, state: 'running' },
      ]);
    },
  );
});
