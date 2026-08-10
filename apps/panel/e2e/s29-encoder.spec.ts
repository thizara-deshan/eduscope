import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, username = 'admin', password = 'battery-staple') {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log In' }).click();
  await expect(page).toHaveURL('/');
}

async function dismissAlerts(page: Page) {
  const ack = page.getByRole('button', { name: /^Acknowledge/ });
  if (await ack.isVisible().catch(() => false)) await ack.click();
}

async function goToEncoder(page: Page) {
  await page.getByRole('button', { name: 'Show controls' }).click();
  await page.getByRole('button', { name: 'Advanced' }).click();
  await expect(page.getByTestId('advanced-shell')).toBeVisible();
  await dismissAlerts(page);
  await page.getByRole('button', { name: /Encoder Settings/ }).click();
  await expect(page.locator('[data-screen="S-29"]')).toBeVisible();
}

test.describe('S-29 Encoder Settings', () => {
  test('primary: only H.264 is offered; the bitrate stepper moves; Save shows the applies-next-session notice', async ({ page }) => {
    await signIn(page);
    await goToEncoder(page);

    await expect(page.getByText('h264')).toBeVisible();
    await expect(page.getByText(/h265|hevc|av1/i)).toHaveCount(0);

    await page.getByRole('button', { name: 'Increase bitrate' }).click();
    await expect(page.getByText(/never applies mid-lecture/)).toBeVisible();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('bitrate-readout')).toContainText('4250');
  });

  test('failure: a bitrate pushed above the capability max is rejected (422) and not applied', async ({ page }) => {
    await signIn(page);
    await goToEncoder(page);

    for (let i = 0; i < 17; i += 1) {
      await page.getByRole('button', { name: 'Increase bitrate' }).click();
    }
    await expect(page.getByTestId('bitrate-readout')).toContainText('8250');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText("Bitrate is outside the encoder's capabilities.")).toBeVisible({ timeout: 5_000 });
  });
});
