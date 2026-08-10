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

async function switchScenario(page: Page, name: string) {
  await openScenarioOverlay(page);
  await page.getByRole('radio', { name: new RegExp(`^${name}$`) }).check();
  await page.getByRole('button', { name: /close scenarios/i }).click();
}

async function dismissAlerts(page: Page) {
  const ack = page.getByRole('button', { name: /^Acknowledge/ });
  if (await ack.isVisible().catch(() => false)) await ack.click();
}

async function goToDevice(page: Page) {
  await page.getByRole('button', { name: 'Show controls' }).click();
  await page.getByRole('button', { name: 'Advanced' }).click();
  await expect(page.getByTestId('advanced-shell')).toBeVisible();
  await page.getByRole('button', { name: /Device & Identity/ }).click();
  await expect(page.locator('[data-screen="S-36"]')).toBeVisible();
}

test.describe('S-36 Device & Identity', () => {
  test('primary: Provisioned chip, copy id, legible features, alerts; acknowledge stays labelled active', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await signIn(page);
    await goToDevice(page);

    await expect(page.getByTestId('provisioned-chip')).toHaveText('Provisioned');
    await page.getByRole('button', { name: 'Copy device ID' }).click();
    await expect(page.getByText(/Copied device ID/)).toBeVisible();

    await expect(page.getByText('On').first()).toBeVisible();

    const alerts = page.getByRole('region', { name: 'Active alerts' });
    const ackButton = alerts.getByRole('button', { name: 'Acknowledge' }).first();
    await ackButton.scrollIntoViewIfNeeded();
    await ackButton.click();
    await expect(alerts.getByText('✓ acknowledged · still active').first()).toBeVisible({ timeout: 5_000 });
  });

  test('failure: capture-fault drives present -> absent -> recovering -> failed, never a dead device', async ({ page }) => {
    test.setTimeout(20_000);
    await signIn(page);
    await switchScenario(page, 'capture-fault');
    await goToDevice(page);
    await dismissAlerts(page);

    await expect(page.getByText('Failed — needs a person. Camera-only recording still works.')).toBeVisible({ timeout: 15_000 });
  });
});
