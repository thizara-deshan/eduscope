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

async function goToUsers(page: Page) {
  await page.getByRole('button', { name: 'Show controls' }).click();
  await page.getByRole('button', { name: 'Advanced' }).click();
  await expect(page.getByTestId('advanced-shell')).toBeVisible();
  await dismissAlerts(page);
  await page.getByRole('button', { name: /User Management/ }).click();
  await expect(page.locator('[data-screen="S-32"]')).toBeVisible();
}

test.describe('S-32 User Management', () => {
  test('primary: search narrows the directory; add a user; institute-owned fields are read-only on edit', async ({ page }) => {
    await signIn(page);
    await goToUsers(page);

    await page.getByLabel('Search users').fill('perera');
    await expect(page.getByTestId('user-row-a.perera')).toBeVisible();
    await expect(page.getByTestId('user-row-n.silva')).toHaveCount(0);
    await page.getByLabel('Search users').fill('');

    await page.getByRole('button', { name: 'Add user' }).click();
    await page.getByLabel('Username').fill('j.newlecturer');
    await page.getByLabel('Display name').fill('J. New Lecturer');
    await page.getByLabel('Password').fill('pw-temp-1');
    await page.getByRole('dialog').getByRole('button', { name: 'Add user' }).click();
    await expect(page.getByTestId('user-row-j.newlecturer')).toBeVisible({ timeout: 5_000 });

    await page.getByTestId('user-row-a.perera').getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByLabel('Display name')).toBeDisabled();
    await expect(page.getByLabel('Role')).toBeDisabled();
  });

  test('failure: deleting admin (self, last admin) is refused; creating a duplicate username 409s', async ({ page }) => {
    await signIn(page);
    await goToUsers(page);

    await page.getByTestId('user-row-admin').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('You cannot delete your own account.')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();

    await page.getByRole('button', { name: 'Add user' }).click();
    await page.getByLabel('Username').fill('admin');
    await page.getByLabel('Display name').fill('Duplicate');
    await page.getByLabel('Password').fill('pw-temp-1');
    await page.getByRole('dialog').getByRole('button', { name: 'Add user' }).click();
    await expect(page.getByText('admin already exists')).toBeVisible({ timeout: 5_000 });
  });
});
