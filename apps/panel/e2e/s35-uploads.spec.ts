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

async function goToUploadQueue(page: Page) {
  await page.getByRole('button', { name: 'Show controls' }).click();
  await page.getByRole('button', { name: 'Advanced' }).click();
  await expect(page.getByTestId('advanced-shell')).toBeVisible();
  await page.getByRole('button', { name: /Upload Queue/ }).click();
  await expect(page.locator('[data-screen="S-35"]')).toBeVisible();
}

test.describe('S-35 Upload queue', () => {
  test('primary: admin sees queued/uploading/done rows and requeues a dead-letter job', async ({ page }) => {
    test.setTimeout(20_000);
    await signIn(page);
    await goToUploadQueue(page);

    await expect(page.getByText('Uploading… 62%')).toBeVisible();
    await expect(page.getByText('Uploaded')).toBeVisible();

    const requeue = page.getByRole('button', { name: 'Try again now' });
    await expect(requeue).toBeVisible();
    await requeue.click();
    // The mock resolves the 202 and its upload.job{queued} near-instantly, so
    // "Requeuing…" is not reliably observable — assert the resolved state instead.
    await expect(page.getByRole('button', { name: 'Try again now' })).toHaveCount(0, { timeout: 5_000 });
  });

  test('failure: wan-loss shows "Waiting for the network", never "failed"', async ({ page }) => {
    test.setTimeout(20_000);
    await signIn(page);
    await switchScenario(page, 'wan-loss');
    await goToUploadQueue(page);

    await expect(page.getByText(/Waiting for the network/)).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(/^failed$/i)).toHaveCount(0);
  });
});
