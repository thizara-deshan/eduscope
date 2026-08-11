import { expect, test, type Page } from '@playwright/test';

async function signInAs(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log In' }).click();
  await expect(page).toHaveURL('/');
}

async function signInLecturer(page: Page) {
  await signInAs(page, 'a.perera', 'correct-horse');
}

async function signInAdmin(page: Page) {
  await signInAs(page, 'admin', 'battery-staple');
}

async function goAdvanced(page: Page) {
  await page.getByRole('button', { name: 'Show controls' }).click();
  await page.getByRole('button', { name: 'Advanced' }).click();
  await expect(page.getByTestId('advanced-shell')).toBeVisible();
}

/** The seeded firmware.update-available alert visually overlaps S-25's topbar at its default position — clear it so header controls stay reachable. */
async function dismissAlerts(page: Page) {
  const ack = page.getByRole('button', { name: /^Acknowledge/ });
  if (await ack.isVisible().catch(() => false)) await ack.click();
}

test.describe('S-25 Advanced shell', () => {
  test('admin primary journey: 11 nav rows, chooses Streaming, aria-current moves, Back returns to /', async ({ page }) => {
    await signInAdmin(page);
    await goAdvanced(page);
    await dismissAlerts(page);
    const nav = page.getByRole('navigation', { name: 'Administration categories' });
    await expect(nav.getByRole('button')).toHaveCount(11);

    await nav.getByRole('button', { name: 'Streaming Configuration' }).click();
    await expect(nav.getByRole('button', { name: 'Streaming Configuration' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-27');

    await page.getByRole('button', { name: 'Back to Dashboard' }).click();
    await expect(page).toHaveURL('/');
  });

  test('lecturer sees only Local Capture, Streaming and Recording Library', async ({ page }) => {
    await signInLecturer(page);
    await goAdvanced(page);
    const nav = page.getByRole('navigation', { name: 'Administration categories' });
    await expect(nav.getByRole('button')).toHaveCount(3);
    await expect(nav.getByRole('button', { name: 'Local Capture Layout' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Streaming Configuration' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Recording Library' })).toBeVisible();
  });

  test('U-6: a lecturer deep-links to an admin-only route and lands in their own shell, never a 403', async ({ page }) => {
    await signInLecturer(page);
    // A programmatic client-side nav simulates a deep link without a full
    // reload — this app issues no persisted session token to restore across
    // one (token-store.ts), so a real page.goto would just bounce to /login.
    await page.evaluate(() => {
      window.history.pushState({}, '', '/advanced/network');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(page).toHaveURL('/advanced/local-capture');
    await expect(page.getByTestId('advanced-shell')).toBeVisible();
    await expect(page.getByText(/403/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Network Settings' })).toHaveCount(0);
  });

  test('live restriction: recording chrome persists in Advanced and no permitted nav item disappears', async ({ page }) => {
    await signInLecturer(page);
    await page.getByRole('button', { name: 'Start Recording' }).click();
    await expect(page.locator('[data-screen="S-05"]')).toBeVisible();
    await page.getByRole('button', { name: 'Show controls' }).click();
    await page.getByRole('button', { name: 'Advanced' }).click();
    await expect(page.getByTestId('advanced-shell')).toBeVisible();
    await expect(page.getByTestId('recording-frame')).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Administration categories' });
    await expect(nav.getByRole('button', { name: 'Local Capture Layout' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Streaming Configuration' })).toBeVisible();
  });

  test('geometry: sidebar does not scroll, every nav row is >=48px, and the page has no scroll', async ({ page }) => {
    await signInAdmin(page);
    await goAdvanced(page);
    const sidebar = page.getByRole('navigation', { name: 'Administration categories' });
    const overflow = await sidebar.evaluate((el) => getComputedStyle(el).overflow);
    expect(overflow === 'visible' || overflow === 'hidden').toBe(true);
    expect(await sidebar.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(0);

    for (const row of await sidebar.getByRole('button').all()) {
      const box = await row.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(48);
    }

    const panelOverflow = await page.evaluate(() => {
      const panel = document.querySelector('.us-panel') as HTMLElement;
      return panel.scrollHeight - panel.clientHeight;
    });
    // Sub-pixel layout rounding, not a real overflow — see the sub-1px budget elsewhere in this suite.
    expect(panelOverflow).toBeLessThanOrEqual(1);
  });
});
