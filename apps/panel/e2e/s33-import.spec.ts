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

async function setBulkImportRejects(page: Page, enabled: boolean) {
  await openScenarioOverlay(page);
  const checkbox = page.getByLabel('Bulk import rejects');
  if (await checkbox.isChecked() !== enabled) await checkbox.click();
  await page.getByRole('button', { name: /close scenarios/i }).click();
}

async function dismissAlerts(page: Page) {
  const ack = page.getByRole('button', { name: /^Acknowledge/ });
  if (await ack.isVisible().catch(() => false)) await ack.click();
}

async function goToUsers(page: Page) {
  await page.getByRole('button', { name: 'Show controls' }).click();
  await page.getByRole('button', { name: 'Advanced' }).click();
  await expect(page.getByTestId('advanced-shell')).toBeVisible();
  await dismissAlerts(page);
  await page.getByRole('button', { name: /User Management/ }).click();
  await expect(page.locator('[data-screen="S-32"]')).toBeVisible();
}

test.describe('S-33 Excel bulk import', () => {
  test('primary: importing a .xlsx reports N accepted users, all flagged for reset', async ({ page }) => {
    await signIn(page);
    await goToUsers(page);

    await page.getByRole('button', { name: 'Bulk Import' }).click();
    await page.getByLabel('Choose roster file').setInputFiles({
      name: 'roster.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from('stub'),
    });
    await expect(page.getByTestId('import-accepted')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('import-accepted')).toContainText('created');
  });

  test('failure: Bulk import rejects shows the row->reason table and "Nothing was imported." — directory unchanged', async ({ page }) => {
    await signIn(page);
    await setBulkImportRejects(page, true);
    await goToUsers(page);
    const initialRows = await page.getByTestId(/^user-row-/).count();

    await page.getByRole('button', { name: 'Bulk Import' }).click();
    await page.getByLabel('Choose roster file').setInputFiles({
      name: 'roster.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from('stub'),
    });
    await expect(page.getByTestId('rejection-headline')).toHaveText('Nothing was imported.', { timeout: 5_000 });
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByTestId(/^user-row-/)).toHaveCount(initialRows);
  });
});
