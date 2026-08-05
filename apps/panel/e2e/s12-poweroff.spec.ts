import { expect, test, type Locator, type Page } from '@playwright/test';
import { TIMERS } from '@eduscope/shared';

const BLOCKED_REASON = 'This device is recording — stop the lecture first.';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Username').fill('a.perera');
  await page.getByLabel('Password').fill('correct-horse');
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

async function openPowerOff(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Show controls' }).click();
  await page.getByRole('button', { name: 'Power off' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Power off this device?' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('S-12 Power-off confirm', () => {
  test('accepted shutdown fills the panel and suppresses the expected disconnect marker', async ({ page }) => {
    test.setTimeout(25_000);
    await signIn(page);
    const dialog = await openPowerOff(page);
    await expect(dialog).toContainText('Engineering Auditorium A301');
    await dialog.getByRole('button', { name: 'Power off' }).click();
    const terminal = page.getByRole('alert');
    await expect(terminal).toContainText('Shutting down', { timeout: 3_000 });
    const terminalBox = await terminal.boundingBox();
    const panelBox = await page.getByTestId('us-panel').boundingBox();
    expect(terminalBox).toEqual(panelBox);
    await page.waitForTimeout(TIMERS['T-WS-STALE'] + 500);
    await expect(terminal).toContainText('Shutting down');
    await expect(page.getByText('Not connected — this may be out of date.')).toHaveCount(0);
  });

  test('a recording started behind the confirm replaces destruction with the lecture jump', async ({ page }) => {
    await signIn(page);
    const dialog = await openPowerOff(page);
    await openScenarioOverlay(page);
    await page.getByTestId('e2e-start-recording').click();
    await page.getByRole('button', { name: /close scenarios/i }).click();
    await expect(page.locator('[data-screen="S-05"]')).toBeVisible({ timeout: 3_000 });
    await dialog.getByRole('button', { name: 'Power off' }).click();
    await expect(dialog.getByTestId('danger-message')).toHaveText(BLOCKED_REASON);
    await expect(dialog.getByRole('button', { name: 'Power off' })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Go to the lecture' }).click();
    await expect(page.getByTestId('timer-card')).toBeFocused();
  });

  test('destruction requires expand, entry, and confirm taps', async ({ page }) => {
    await signIn(page);
    await expect(page.getByRole('button', { name: 'Power off' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Show controls' }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.getByRole('button', { name: 'Power off' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Power off this device?' });
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Power off' }).click();
    await expect(page.getByRole('alert')).toContainText('Shutting down', { timeout: 3_000 });
  });

  test('the room entry is blocked with an inline reason while recording', async ({ page }) => {
    await signIn(page);
    await page.getByRole('button', { name: 'Start Recording' }).click();
    await expect(page.locator('[data-screen="S-05"]')).toBeVisible({ timeout: 3_000 });
    await page.getByRole('button', { name: 'Show controls' }).click();
    const power = page.getByRole('button', { name: 'Power off' });
    await expect(power).toBeDisabled();
    await expect(power).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByText(BLOCKED_REASON)).toBeVisible();
    await expect(page.getByRole('alertdialog', { name: 'Power off this device?' })).toHaveCount(0);
  });

  test('poweroff-not-halted traverses refusal, not-halted, retry, and terminal acceptance', async ({ page }) => {
    test.setTimeout(30_000);
    await signIn(page);
    await switchScenario(page, 'poweroff-not-halted');

    let dialog = await openPowerOff(page);
    await dialog.getByRole('button', { name: 'Power off' }).click();
    await expect(dialog.getByTestId('danger-message')).toHaveText(
      'The device could not be reached to shut it down.',
    );
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Close' }).click();

    await page.getByRole('button', { name: 'Power off' }).click();
    dialog = page.getByRole('alertdialog', { name: 'Power off this device?' });
    await dialog.getByRole('button', { name: 'Power off' }).click();
    await expect(page.getByText('The device has not shut down yet.')).toBeVisible({ timeout: 11_000 });
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('alert')).toContainText('Shutting down', { timeout: 3_000 });
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  });

  test('an accepted command does not optimistically close its pending dialog', async ({ page }) => {
    await signIn(page);
    const dialog = await openPowerOff(page);
    await dialog.getByRole('button', { name: 'Power off' }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Powering off/ })).toBeDisabled();
  });
});
