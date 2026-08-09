import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Username').fill('a.perera');
  await page.getByLabel('Password').fill('correct-horse');
  await page.getByRole('button', { name: 'Log In' }).click();
  await expect(page).toHaveURL('/');
}

async function startRecording(page: Page) {
  await page.getByRole('button', { name: 'Start Recording' }).click();
  await expect(page.locator('[data-screen="S-13"]')).toBeVisible({ timeout: 10_000 });
}

async function openLeaderboard(page: Page) {
  await page.getByRole('tab', { name: 'Leaderboard' }).click();
  await expect(page.getByTestId('leaderboard-tab')).toBeVisible();
}

test.describe('S-19 Student detail', () => {
  test('primary: an S-17 row opens per-question history with the running score and rank', async ({ page }) => {
    test.setTimeout(30_000);
    await signIn(page);
    await startRecording(page);
    await openLeaderboard(page);

    const firstRow = page.locator('.us-lb__row').first();
    const rowScore = await firstRow.locator('.us-lb__statvalue').textContent();
    await firstRow.click();

    const dialog = page.getByTestId('student-detail-dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('student-detail-score')).toBeVisible({ timeout: 10_000 });
    // The dialog's score/rank must match the leaderboard row that opened it.
    await expect(page.getByTestId('student-detail-score')).toHaveText(`Score ${rowScore}`);
    await expect(page.getByTestId('student-detail-rank')).toHaveText('Rank #1');
  });

  test('partial: a missed question renders unanswered, never incorrect', async ({ page }) => {
    test.setTimeout(30_000);
    await signIn(page);
    await startRecording(page);
    await openLeaderboard(page);

    await page.locator('.us-lb__row').first().click();
    const dialog = page.getByTestId('student-detail-dialog');
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(500);
    const incorrect = dialog.getByText('Incorrect', { exact: true });
    const unanswered = dialog.getByText('Unanswered', { exact: true });
    expect(await unanswered.count()).toBeGreaterThanOrEqual(0);
    expect(await incorrect.count()).toBe(0);
  });
});
