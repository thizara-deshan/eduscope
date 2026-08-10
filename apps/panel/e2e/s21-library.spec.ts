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

test.describe('S-21 Recordings library', () => {
  test('primary: the header link opens the library and every seeded row renders its badge', async ({ page }) => {
    await signIn(page);
    await goToLibrary(page);

    await expect(page.getByText('Uploaded').first()).toBeVisible();
    await expect(page.getByText(/Uploading…/).first()).toBeVisible();
  });

  test('primary (S-24 fold): an admin deletes an uploaded recording and the row disappears', async ({ page }) => {
    await signIn(page, 'admin', 'battery-staple');
    await goToLibrary(page);

    const uploadedRow = page.locator('.us-reclist__item', { hasText: 'Uploaded' }).first();
    const title = await uploadedRow.locator('.us-reclist__title').textContent();
    await uploadedRow.getByRole('button', { name: /More actions/ }).click();
    await uploadedRow.getByRole('menuitem', { name: 'Delete' }).click();

    const dialog = page.getByRole('alertdialog', { name: 'Delete this recording?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Delete' }).click();
    await expect(dialog).toHaveCount(0, { timeout: 5_000 });
    if (title) await expect(page.getByText(title)).toHaveCount(0);
  });

  test('failure: a lecturer never sees the Delete control', async ({ page }) => {
    await signIn(page);
    await goToLibrary(page);

    const row = page.locator('.us-reclist__item').first();
    await row.getByRole('button', { name: /More actions/ }).click();
    await expect(row.getByRole('menuitem', { name: 'Delete' })).toHaveCount(0);
  });

  test('failure: disk-full removes a row with a non-alarming, reason-keyed note', async ({ page }) => {
    test.setTimeout(20_000);
    await signIn(page);
    await switchScenario(page, 'disk-full');
    await goToLibrary(page);

    await expect(page.getByText(/removed to free up space/)).toBeVisible({ timeout: 8_000 });
  });
});
