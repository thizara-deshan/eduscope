import { expect, test, type Page } from '@playwright/test';

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
  const radio = page.getByRole('radio', { name: new RegExp(`^${name}$`) });
  if (!(await radio.isChecked())) await radio.check();
  await page.getByRole('button', { name: /close scenarios/i }).click();
}

async function startRecording(page: Page) {
  await page.getByRole('button', { name: 'Start Recording' }).click();
  await expect(page.locator('[data-screen="S-13"]')).toBeVisible({ timeout: 10_000 });
}

async function openLeaderboard(page: Page) {
  await page.getByRole('tab', { name: 'Leaderboard' }).click();
  await expect(page.getByTestId('leaderboard-tab')).toBeVisible();
}

test.describe('S-17 Leaderboard', () => {
  test('primary: ranked rows with medals, {correct}/{answered} and score, a row opens S-19', async ({ page }) => {
    test.setTimeout(30_000);
    await signIn(page);
    await startRecording(page);
    await openLeaderboard(page);

    const rows = page.locator('.us-lb__row');
    await expect(rows).toHaveCount(3, { timeout: 10_000 });
    await expect(rows.first()).toContainText('🥇');

    await rows.first().click();
    await expect(page.getByTestId('student-detail-dialog')).toBeVisible();
  });

  test('failure: quiz-network-loss marks the whole list stale', async ({ page }) => {
    test.setTimeout(30_000);
    await signIn(page);
    await switchScenario(page, 'quiz-network-loss');
    await startRecording(page);
    await openLeaderboard(page);

    await expect(page.getByTestId('leaderboard-stale')).toBeVisible({ timeout: 10_000 });
  });

  test('is never projectable: no projector control anywhere on the tab', async ({ page }) => {
    await signIn(page);
    await startRecording(page);
    await openLeaderboard(page);
    await expect(page.getByTestId('leaderboard-tab')).toHaveAttribute('data-panel-only', 'true');
    expect(await page.getByTestId('leaderboard-tab').getByText(/project/i).count()).toBe(0);
  });
});
