import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, username = 'a.perera', password = 'correct-horse') {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
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
  await page.getByRole('radio', { name: new RegExp(`^${name}$`) }).check();
  await page.getByRole('button', { name: /close scenarios/i }).click();
}

/** A seeded alert can visually overlap the selection bar's action button — clear it first (mirrors S-25's dismissAlerts). */
async function dismissAlerts(page: Page) {
  const ack = page.getByRole('button', { name: /^Acknowledge/ });
  if (await ack.isVisible().catch(() => false)) await ack.click();
}

async function selectFirstRowAndOpenExport(page: Page) {
  // The recording library now lives inside the Advanced shell (a dedicated
  // sidebar section), not a header link.
  await page.getByRole('button', { name: 'Show controls' }).click();
  await page.getByRole('button', { name: 'Advanced' }).click();
  await expect(page.getByTestId('advanced-shell')).toBeVisible();
  await page.getByRole('button', { name: 'Recording Library' }).click();
  await expect(page.locator('[data-screen="S-21"]')).toBeVisible();
  await dismissAlerts(page);
  await page.getByRole('button', { name: 'Select' }).click();
  await page.locator('.us-reclist__checkbox').first().check();
  await page.getByRole('button', { name: /Copy to USB/ }).click();
  await expect(page.getByRole('dialog', { name: 'Copy to USB' })).toBeVisible();
}

test.describe('S-23 USB export flow', () => {
  test('primary: select, pick a drive, watch real-byte progress to completed, "Safe to remove"', async ({ page }) => {
    test.setTimeout(30_000);
    await signIn(page);
    await selectFirstRowAndOpenExport(page);

    await expect(page.getByText('Choose a drive:')).toBeVisible();
    await page.getByRole('button', { name: /BACKUP-1/ }).click();
    await page.getByRole('button', { name: /Copy .* GB →/ }).click();

    await expect(page.getByText('Copying…')).toBeVisible();
    await expect(page.getByText('Safe to remove the drive.')).toBeVisible({ timeout: 15_000 });
  });

  test('failure: usb-pull — the source is safe, Try again re-copies', async ({ page }) => {
    test.setTimeout(30_000);
    await signIn(page);
    await switchScenario(page, 'usb-pull');
    await selectFirstRowAndOpenExport(page);

    await page.getByRole('button', { name: /BACKUP-1/ }).click();
    await page.getByRole('button', { name: /Copy .* GB →/ }).click();

    await expect(page.getByText(/removed before the copy finished/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/recordings are safe on the device/)).toBeVisible();
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByText('Copying…')).toBeVisible();
  });
});
