import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, username = 'admin', password = 'battery-staple') {
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

async function setFirmwareOutcome(page: Page, label: string) {
  await openScenarioOverlay(page);
  await page.getByLabel(label).check();
  await page.getByRole('button', { name: /close scenarios/i }).click();
}

async function dismissAlerts(page: Page) {
  const ack = page.getByRole('button', { name: /^Acknowledge/ });
  if (await ack.isVisible().catch(() => false)) await ack.click();
}

async function goToFirmware(page: Page) {
  await page.getByRole('button', { name: 'Show controls' }).click();
  await page.getByRole('button', { name: 'Advanced' }).click();
  await expect(page.getByTestId('advanced-shell')).toBeVisible();
  await dismissAlerts(page);
  await page.getByRole('button', { name: /Firmware Update/ }).click();
  await expect(page.locator('[data-screen="S-31"]')).toBeVisible();
}

test.describe('S-31 Firmware Update', () => {
  test('primary: update-available -> Apply steps through to done, unmissable reboot message', async ({ page }) => {
    test.setTimeout(20_000);
    await signIn(page);
    // firmwareOutcome:'update-available' is the mock's default world seed.
    await goToFirmware(page);

    await expect(page.getByTestId('firmware-up-to-date')).toBeVisible();
    await page.getByRole('button', { name: 'Check for updates' }).click();
    await expect(page.getByTestId('firmware-update-available')).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: 'Apply update' }).click();
    await expect(page.getByTestId('firmware-done')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/reboot is required/)).toBeVisible();
  });

  test('failure: signature-fail is a loud, distinct state', async ({ page }) => {
    test.setTimeout(20_000);
    await signIn(page);
    await setFirmwareOutcome(page, 'Firmware outcome: signature-fail');
    await goToFirmware(page);

    await page.getByRole('button', { name: 'Check for updates' }).click();
    await expect(page.getByTestId('firmware-update-available')).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: 'Apply update' }).click();
    await expect(page.getByTestId('firmware-signature-failed')).toBeVisible({ timeout: 10_000 });
  });
});
