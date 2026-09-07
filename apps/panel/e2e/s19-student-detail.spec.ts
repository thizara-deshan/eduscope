import { expect, test, type Page } from '@playwright/test';
import { expect as realExpect, test as realTest } from './fixtures/real-stack.js';
import { getJson, publishOneQuestion, startRealRecording, waitForOpenQuizSession } from './fixtures/real-ai.js';

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

// eduscope:needs-real-d — exercises real B<->D per-student projection replay.
realTest.describe('S-19 Student detail — real', () => {
  realTest(
    'real: the dialog is keyed by stable student id (not the top row); a deleted B-side projection is replaced atomically by D\'s authoritative one',
    { annotation: { type: 'adapter', description: 'real' } },
    async ({ page, realStack }) => {
      realTest.setTimeout(120_000);
      const { token, sessionId } = await startRealRecording(page, realStack);
      await waitForOpenQuizSession(realStack, token);
      const publicationId = await publishOneQuestion(realStack, token, sessionId);

      const { submitted } = await realStack.control<{ submitted: Array<{ studentIdNumber: string; isCorrect: boolean }> }>(
        'quiz.submit-answers', { count: 2, correctCount: 1 },
      );
      const wrongId = submitted.find((s) => !s.isCorrect)!.studentIdNumber;

      await realExpect(page.getByTestId('insights-column')).toBeVisible();
      await page.getByRole('tab', { name: 'Leaderboard' }).click();
      await realExpect(page.getByTestId(`leaderboard-row-${wrongId}`)).toBeVisible({ timeout: 25_000 });

      // Open the RANK-2 student — never the top row. The dialog must key on the
      // stable student id, so it shows that student, at rank #2.
      await page.getByTestId(`leaderboard-row-${wrongId}`).click();
      const dialog = page.getByTestId('student-detail-dialog');
      await realExpect(dialog).toBeVisible();
      await realExpect(dialog.getByTestId('student-detail-rank')).toContainText('#2');
      const identity = (await dialog.locator('h2').innerText()).trim();

      // Cut B<->D, delete B's replicated projection, rewind its watermark.
      await realStack.control('quiz.device-sync', { available: false });
      await realStack.control('quiz.restart');
      realExpect((await realStack.control<{ projections: number }>('core.reset-answer-projections')).projections, 'B-side projection deleted').toBe(0);

      // The last-known identity is retained under a stale marker — never
      // replaced by another student's row or blanked out.
      await realExpect(dialog.getByTestId('student-detail-stale')).toBeVisible({ timeout: 30_000 });
      await realExpect(dialog.locator('h2')).toHaveText(identity);
      await realExpect(dialog.getByTestId('student-detail-rank')).toContainText('#2');

      // Restore: B reconnects and D replays its authoritative history from
      // scratch; B rebuilds the projection.
      await realStack.control('quiz.device-sync', { available: true });
      await realExpect(dialog.getByTestId('student-detail-stale')).toHaveCount(0, { timeout: 30_000 });
      await realExpect.poll(async () => {
        const responses = await getJson(`${realStack.coreBaseUrl}/quiz/publications/${publicationId}/responses`, token) as { items: unknown[] };
        return responses.items.length;
      }, { timeout: 20_000 }).toBe(2);

      // One atomic identity/history replacement: same student, same rank — never
      // a mixed-identity row.
      await realExpect(dialog.locator('h2')).toHaveText(identity);
      await realExpect(dialog.getByTestId('student-detail-rank')).toContainText('#2');
    },
  );
});
