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

async function setDiskHealth(page: Page, label: string) {
  await openScenarioOverlay(page);
  await page.getByLabel(label).check();
  await page.getByRole('button', { name: /close scenarios/i }).click();
}

async function dismissAlerts(page: Page) {
  const ack = page.getByRole('button', { name: /^Acknowledge/ });
  if (await ack.isVisible().catch(() => false)) await ack.click();
}

async function goToStorage(page: Page) {
  await page.getByRole('button', { name: 'Show controls' }).click();
  await page.getByRole('button', { name: 'Advanced' }).click();
  await expect(page.getByTestId('advanced-shell')).toBeVisible();
  await dismissAlerts(page);
  await page.getByRole('button', { name: /Local Storage/ }).click();
  await expect(page.locator('[data-screen="S-30"]')).toBeVisible();
}

test.describe('S-30 Local Storage', () => {
  test('primary: stats, SMART (in words) and retention numbers render; format stays disabled until the name matches', async ({ page }) => {
    await signIn(page);
    await goToStorage(page);

    await expect(page.getByText(/free of/)).toBeVisible();
    await expect(page.getByText('good')).toBeVisible();
    await expect(page.getByText(/past 90 days/)).toBeVisible();

    await page.getByRole('button', { name: 'Format…' }).click();
    const formatButton = page.getByRole('button', { name: 'Format volume' });
    await expect(formatButton).toBeDisabled();
    await page.getByLabel('Type RECORDINGS to confirm formatting').fill('RECORDINGS');
    await expect(formatButton).toBeEnabled();
  });

  test('failure: failing SMART renders honestly', async ({ page }) => {
    await signIn(page);
    await setDiskHealth(page, 'Disk health: failing');
    await goToStorage(page);
    await expect(page.getByText('failing')).toBeVisible();
  });
});
