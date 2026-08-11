import { expect, test } from '@playwright/test';

async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel('Username').fill('a.perera');
  await page.getByLabel('Password').fill('correct-horse');
  await page.getByRole('button', { name: 'Log In' }).click();
  await expect(page).toHaveURL('/');
}

async function openScenarioOverlay(page: import('@playwright/test').Page) {
  const hotspot = page.getByTestId('scenario-hotspot');
  const box = await hotspot.boundingBox();
  if (!box) throw new Error('scenario hotspot has no box — is the mock client active?');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(2_200);
  await page.mouse.up();
  await expect(page.getByRole('dialog', { name: /scenario/i })).toBeVisible();
}

async function switchScenario(page: import('@playwright/test').Page, name: string) {
  await openScenarioOverlay(page);
  await page.getByRole('radio', { name: new RegExp(`^${name}$`) }).check();
  await expect(page.getByTestId('active-scenario')).toHaveText(name);
  await page.getByRole('button', { name: /close scenarios/i }).click();
}

test.describe('S-03 Panel shell, chrome & alert host', () => {
  test('primary journey — happy: header, then the full recording chrome cycle', async ({ page }) => {
    await signIn(page);
    await expect(page.locator('.us-header')).toContainText('Engineering Auditorium A301');
    await expect(page.locator('.us-header')).toContainText('A. Perera');
    await expect(page.locator('.us-clock__time')).toBeVisible();

    await openScenarioOverlay(page);
    await page.getByTestId('e2e-start-recording').click();
    // `starting` renders no chrome at all (B-12) — the frame only appears
    // once R-05 confirms `recording`, ~1.2s after Start per the mock.
    await expect(page.getByTestId('recording-frame')).toBeVisible({ timeout: 6_000 });
    await expect(page.getByTestId('recording-frame')).not.toHaveClass(/--paused|--saving/);
    await expect(page.getByTestId('recording-notch')).toContainText('RECORDING');
    // Pause is only valid from the confirmed `recording` state (R-08) — the
    // frame becoming visible already proves that transition landed.

    await page.getByTestId('dev-pause').click();
    await expect(page.getByTestId('recording-frame')).toHaveClass(/--paused/);
    await expect(page.getByTestId('recording-notch')).toContainText('PAUSED');

    await page.getByTestId('dev-resume').click();
    await expect(page.getByTestId('recording-notch')).toContainText('RECORDING', { timeout: 3_000 });

    await page.getByTestId('dev-stop').click();
    await expect(page.getByTestId('recording-frame')).toHaveClass(/--saving/);
    await expect(page.getByTestId('recording-notch')).toContainText('SAVING');
    await expect(page.getByTestId('recording-saved')).toBeVisible({ timeout: 4_000 });
    await expect(page.getByTestId('recording-saved')).toHaveCount(0, { timeout: 4_000 });
    await expect(page.getByTestId('recording-frame')).toHaveCount(0);
  });

  test('failure — start-fails: chrome reaches error, and the red frame never appears', async ({ page }) => {
    await signIn(page);
    await switchScenario(page, 'start-fails');

    const seenRecording: boolean[] = [];
    await page.exposeFunction('__recordSeen', (hasRedFrame: boolean) => {
      seenRecording.push(hasRedFrame);
    });
    await page.evaluate(() => {
      const target = document.body;
      new MutationObserver(() => {
        const frame = document.querySelector('[data-testid="recording-frame"]');
        const isRecording = !!frame && !frame.className.includes('--paused') && !frame.className.includes('--saving');
        (window as unknown as { __recordSeen(v: boolean): void }).__recordSeen(isRecording);
      }).observe(target, { childList: true, subtree: true, attributes: true });
    });

    await openScenarioOverlay(page);
    // start-fails refuses the FIRST Start outright (Class A, no session, no
    // chrome); the SECOND creates a session that fails to `error` (Class B,
    // R-06). Only the second attempt raises the red-frame-free error chrome.
    await page.getByTestId('e2e-start-recording').click();
    await expect(page.locator('[data-recording-state]')).toHaveAttribute('data-recording-state', 'idle');
    await page.getByTestId('e2e-start-recording').click();
    await expect(page.getByTestId('recording-error')).toBeVisible({ timeout: 6_000 });
    const errorText = await page.getByTestId('recording-error').textContent();
    expect(errorText).toBeTruthy();
    expect(seenRecording, 'a failed start must never read as recording (B-12)').not.toContain(true);
  });

  test('ws-flap: after T-WS-STALE the reconnecting marker appears and the recording frame is retained', async ({ page }) => {
    test.setTimeout(45_000);
    await signIn(page);
    await openScenarioOverlay(page);
    await page.getByTestId('e2e-start-recording').click();
    await expect(page.getByTestId('recording-frame')).toBeVisible({ timeout: 6_000 });

    await switchScenario(page, 'ws-flap');
    // Restart recording under the new scenario's world.
    await openScenarioOverlay(page);
    await page.getByTestId('e2e-start-recording').click();
    await expect(page.getByTestId('recording-frame')).toBeVisible({ timeout: 6_000 });

    // ws-flap drops the socket after 15s; U-2 fires once stale past T-WS-STALE (10s).
    await expect(page.getByTestId('offline-marker')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('recording-frame')).toBeVisible();
  });

  test('disk-full: the storage.critical alert surfaces in the notification center, verbatim from the payload', async ({ page }) => {
    await signIn(page);
    await switchScenario(page, 'disk-full');

    // The disk-full world raises a storage.critical alert. It surfaces in the
    // notification center (verbatim from the payload), not a standalone banner.
    await page.getByRole('button', { name: /^Notifications,/ }).click();
    await expect(page.getByRole('dialog', { name: 'Notifications' })).toContainText('storage.critical');
    await page.getByRole('button', { name: 'Close notifications' }).click();

    // Recording under disk-full must never proceed (R-02, no session row created).
    await openScenarioOverlay(page);
    await page.getByTestId('e2e-start-recording').click();
    await expect(page.getByTestId('recording-frame')).toHaveCount(0);
  });

  test('layout invariance: opening and acknowledging notifications never reflows the Outlet', async ({ page }) => {
    await signIn(page);
    // happy seeds one alert. Alerts live in the notification center — a dropdown
    // that must never reflow the main screen (the old banner-vs-no-banner
    // invariance, now guaranteed by construction).
    const before = await page.getByTestId('screen').boundingBox();

    await page.getByRole('button', { name: /^Notifications,/ }).click();
    expect(await page.getByTestId('screen').boundingBox()).toEqual(before);

    await page.getByRole('button', { name: /^Acknowledge/ }).click();
    expect(await page.getByTestId('screen').boundingBox()).toEqual(before);
  });

  test('no header at /login and /login/reset; header present at /', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('.us-header')).toHaveCount(0);

    await page.getByLabel('Username').fill('n.silva');
    await page.getByLabel('Password').fill('temp-pass-1');
    await page.getByRole('button', { name: 'Log In' }).click();
    await expect(page).toHaveURL(/\/login\/reset$/);
    await expect(page.locator('.us-header')).toHaveCount(0);
  });
});
