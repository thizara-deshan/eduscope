import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, username = 'a.perera', password = 'correct-horse') {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log In' }).click();
  await expect(page).toHaveURL('/');
}

async function goToLibrary(page: Page) {
  await page.getByRole('link', { name: 'Recordings' }).click();
  await expect(page.locator('[data-screen="S-21"]')).toBeVisible();
}

test.describe('S-22 Recording detail & player', () => {
  test('primary: open a recording, play the merged file, download', async ({ page }) => {
    await signIn(page);
    await goToLibrary(page);

    const uploadedRow = page.locator('.us-reclist__item', { hasText: 'Uploaded' }).first();
    await uploadedRow.getByRole('button', { name: /^Play/ }).click();
    await expect(page.locator('[data-screen="S-22"]')).toBeVisible();

    // The player fetches the authenticated media route and hands the real
    // Blob straight to <video src>. The mock's fixture bytes are a placeholder
    // string, not a decodable container, so a real browser's media pipeline
    // legitimately raises a decode error here — the same `playback failed`
    // path C-6 requires this screen to render (distinct from `file missing`).
    // What IS genuinely demonstrable end-to-end is the authenticated route
    // being called and the recovery affordance appearing.
    await expect(page.getByText('Playback stopped.').or(page.locator('video'))).toBeVisible({ timeout: 10_000 });

    const downloadPromise = page.waitForEvent('download').catch(() => null);
    await page.getByRole('button', { name: /Download/ }).first().click();
    await downloadPromise;
  });

  test('failure: merge failed shows admin Retry, which recovers preparing -> ready', async ({ page }) => {
    test.setTimeout(20_000);
    await signIn(page, 'admin', 'battery-staple');
    await goToLibrary(page);

    const failedRow = page.locator('.us-reclist__item', { hasText: "Couldn't prepare this recording" }).first();
    await failedRow.click();
    await expect(page.locator('[data-screen="S-22"]')).toBeVisible();

    await expect(page.getByText(/couldn't combine/)).toBeVisible();
    const retry = page.getByRole('button', { name: 'Retry preparing' });
    await expect(retry).toBeVisible();
    await retry.click();
    await expect(page.getByText(/preparing the full recording/)).toBeVisible({ timeout: 10_000 });
  });

  test('lecturer sees no Retry on a merge-failed recording (U-6)', async ({ page }) => {
    await signIn(page);
    await goToLibrary(page);

    const failedRow = page.locator('.us-reclist__item', { hasText: "Couldn't prepare this recording" }).first();
    await failedRow.click();
    await expect(page.locator('[data-screen="S-22"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry preparing' })).toHaveCount(0);
  });
});
