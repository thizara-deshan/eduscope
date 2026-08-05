import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log In' }).click();
  if (username === 'n.silva') {
    await expect(page).toHaveURL(/\/login\/reset$/);
    await page.getByLabel('Current password').fill(password);
    await page.getByLabel('New password', { exact: true }).fill('New-lecturer-9');
    await page.getByLabel('Confirm new password').fill('New-lecturer-9');
    await page.getByRole('button', { name: 'Set password' }).click();
  }
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

async function seedLockedRecording(page: Page) {
  await openScenarioOverlay(page);
  const control = page.getByRole('checkbox', { name: 'Recorder owned by another user' });
  if (!(await control.isChecked())) await control.check();
  await page.getByRole('button', { name: /close scenarios/i }).click();
  await expect(page.locator('[data-screen="S-06"]')).toBeVisible();
}

async function openTakeover(page: Page) {
  await page.getByRole('button', { name: 'Take over' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Take over this recording?' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('S-06 Recorder lock and takeover', () => {
  test('primary journey — admin takes over and retains prior-owner attribution', async ({ page }) => {
    await signIn(page, 'admin', 'battery-staple');
    await seedLockedRecording(page);
    const card = page.getByTestId('lock-card');
    await expect(card).toContainText('A. Perera');
    await expect(card).toContainText('CS2043 — Lecture 7');
    const elapsed = page.getByTestId('lock-elapsed');
    const first = await elapsed.textContent();
    await page.waitForTimeout(1_100);
    expect(await elapsed.textContent()).not.toBe(first);

    const dialog = await openTakeover(page);
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await Promise.all([
      expect(dialog.getByRole('button', { name: /Taking over/ })).toBeDisabled(),
      dialog.getByRole('button', { name: 'Take over' }).click(),
    ]);
    await expect(page.locator('[data-screen="S-05"]')).toBeVisible();
    await expect(page.getByTestId('takeover-notice')).toContainText(
      'You took over this recording from A. Perera',
    );
  });

  test('takeover refused after the lecture ends replaces the destructive action with Close', async ({ page }) => {
    await signIn(page, 'admin', 'battery-staple');
    await seedLockedRecording(page);
    const dialog = await openTakeover(page);

    await openScenarioOverlay(page);
    await page.getByTestId('dev-stop').click();
    await page.getByRole('button', { name: /close scenarios/i }).click();
    await expect(page.locator('[data-recording-state]')).toHaveAttribute('data-recording-state', 'completed', {
      timeout: 4_000,
    });
    await dialog.getByRole('button', { name: 'Take over' }).click();
    await expect(dialog.getByTestId('danger-message')).toHaveText('That lecture has already ended.');
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Take over' })).toHaveCount(0);
  });

  test('one R-21 state renders the new-owner and displaced-owner sides sequentially', async ({ page }) => {
    await signIn(page, 'admin', 'battery-staple');
    await seedLockedRecording(page);
    const dialog = await openTakeover(page);
    await dialog.getByRole('button', { name: 'Take over' }).click();
    await expect(page.getByTestId('takeover-notice')).toContainText(
      'You took over this recording from A. Perera',
    );

    await page.getByRole('button', { name: /Device Administrator/ }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL('/login');
    await page.getByLabel('Username').fill('a.perera');
    await page.getByLabel('Password').fill('correct-horse');
    await page.getByRole('button', { name: 'Log In' }).click();

    await expect(page.locator('[data-screen="S-06"]')).toBeVisible();
    await expect(page.getByTestId('lock-card')).toBeVisible();
    await expect(page.getByTestId('takeover-notice')).toContainText(
      'An administrator took over this recording.',
    );
    await expect(page.getByTestId('takeover-notice')).toContainText('Device Administrator took over');
  });

  test('a lecturer sees no action inside the lock card', async ({ page }) => {
    await signIn(page, 'n.silva', 'temp-pass-1');
    await seedLockedRecording(page);
    const card = page.getByTestId('lock-card');
    await expect(card).toContainText('Only A. Perera or an administrator can stop this recording.');
    await expect(card.getByRole('button')).toHaveCount(0);
  });

  test('the confirmation keeps 24px danger separation and the destructive action last', async ({ page }) => {
    await signIn(page, 'admin', 'battery-staple');
    await seedLockedRecording(page);
    const dialog = await openTakeover(page);
    const footer = dialog.locator('.us-dangerconfirm__footer');
    expect(await footer.evaluate((node) => getComputedStyle(node).gap)).toBe('24px');
    const focusableLabels = await dialog.locator('button:not([disabled])').allTextContents();
    expect(focusableLabels.at(-1)?.trim()).toBe('Take over');
  });

  test('recording chrome remains visible on the non-owner lock view', async ({ page }) => {
    await signIn(page, 'admin', 'battery-staple');
    await seedLockedRecording(page);
    await expect(page.getByTestId('recording-frame')).toBeVisible();
    await expect(page.getByTestId('recording-notch')).toContainText('RECORDING');
  });
});
