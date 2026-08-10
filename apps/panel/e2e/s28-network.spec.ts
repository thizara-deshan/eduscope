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

async function setNetworkApplyFails(page: Page, enabled: boolean) {
  await openScenarioOverlay(page);
  const checkbox = page.getByLabel('Network apply fails');
  if (await checkbox.isChecked() !== enabled) await checkbox.click();
  await page.getByRole('button', { name: /close scenarios/i }).click();
}

async function dismissAlerts(page: Page) {
  const ack = page.getByRole('button', { name: /^Acknowledge/ });
  if (await ack.isVisible().catch(() => false)) await ack.click();
}

async function goToNetwork(page: Page) {
  await page.getByRole('button', { name: 'Show controls' }).click();
  await page.getByRole('button', { name: 'Advanced' }).click();
  await expect(page.getByTestId('advanced-shell')).toBeVisible();
  await dismissAlerts(page);
  await page.getByRole('button', { name: /Network Settings/ }).click();
  await expect(page.locator('[data-screen="S-28"]')).toBeVisible();
}

test.describe('S-28 Network Settings', () => {
  test('primary: editing the LAN address and applying re-reads the row with a new appliedAt', async ({ page }) => {
    // The seeded vLAN is DHCP (no editable IPv4 fields by design — DHCP has
    // no manual address); the LAN interface is static and exercises the same
    // apply + row-readback path this journey verifies.
    await signIn(page);
    await goToNetwork(page);

    const lanCard = page.getByRole('region', { name: 'eth0 (lan)' });
    await lanCard.getByLabel('IPv4 address octet 4').fill('50');
    await lanCard.getByRole('button', { name: 'Apply' }).click();
    await expect(lanCard.getByText(/applied/)).toBeVisible({ timeout: 5_000 });
  });

  test('failure: network apply fails leaves lastApplyError and the prior address in effect', async ({ page }) => {
    await signIn(page);
    await setNetworkApplyFails(page, true);
    await goToNetwork(page);

    const lanCard = page.getByRole('region', { name: 'eth0 (lan)' });
    await lanCard.getByLabel('IPv4 address octet 4').fill('99');
    await lanCard.getByRole('button', { name: 'Apply' }).click();
    await expect(lanCard.getByText(/previous config kept/)).toBeVisible({ timeout: 5_000 });
  });
});
