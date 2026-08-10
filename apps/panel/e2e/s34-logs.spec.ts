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

async function goToLogs(page: Page) {
  await page.getByRole('button', { name: 'Show controls' }).click();
  await page.getByRole('button', { name: 'Advanced' }).click();
  await expect(page.getByTestId('advanced-shell')).toBeVisible();
  await dismissAlerts(page);
  await page.getByRole('button', { name: /System Logs/ }).click();
  await expect(page.locator('[data-screen="S-34"]')).toBeVisible();
}

test.describe('S-34 System Logs', () => {
  test('primary: level+category filter narrows the table; a live-tail entry appears atop; CSV export downloads', async ({ page }) => {
    test.setTimeout(20_000);
    await signIn(page);
    await goToLogs(page);

    const before = await page.locator('[data-testid^="log-row-"]').count();
    await page.getByRole('button', { name: 'WARN', exact: true }).click();
    await page.getByRole('button', { name: 'Hardware', exact: true }).click();
    await expect(page.locator('[data-testid^="log-row-"]')).toHaveCount(1, { timeout: 5_000 });
    expect(before).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'All levels' }).click();
    await page.getByRole('button', { name: 'All categories' }).click();
    await expect(page.getByText('students-cam signal dipped.')).toBeVisible({ timeout: 5_000 });

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export CSV' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('logs.csv');
  });

  test('failure: ws-flap marks the tail stale while the query still returns rows (U-2)', async ({ page }) => {
    test.setTimeout(45_000);
    await signIn(page);
    await switchScenario(page, 'ws-flap');
    await goToLogs(page);

    // wsFlap drops the socket at 15s (downMs 12s); T-WS-STALE is 10s after
    // the drop, so "stale" is not reachable before ~25s into the scenario.
    await expect(page.getByTestId('tail-stale')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-testid^="log-row-"]').first()).toBeVisible();
  });
});
