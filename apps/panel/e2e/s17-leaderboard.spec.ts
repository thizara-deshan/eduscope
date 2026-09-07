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

// eduscope:needs-real-d — exercises the real B<->D leaderboard replay/parity path.
realTest.describe('S-17 Leaderboard — real', () => {
  realTest(
    'real: tied histories submitted during a sync gap stay stale until replay, then panel dense ranks match D exactly with no duplicate row',
    { annotation: { type: 'adapter', description: 'real' } },
    async ({ page, realStack }) => {
      realTest.setTimeout(120_000);
      const { token, sessionId } = await startRealRecording(page, realStack);
      await waitForOpenQuizSession(realStack, token);
      await publishOneQuestion(realStack, token, sessionId);

      await realExpect(page.getByTestId('insights-column')).toBeVisible();
      await page.getByRole('tab', { name: 'Leaderboard' }).click();
      await realExpect(page.getByTestId('leaderboard-tab')).toBeVisible();

      // Cut B<->D while D stays up for phones, then submit two correct (tied)
      // and one incorrect answer to D.
      await realStack.control('quiz.device-sync', { available: false });
      await realStack.control('quiz.restart');
      const { submitted } = await realStack.control<{ submitted: Array<{ studentIdNumber: string; isCorrect: boolean }> }>(
        'quiz.submit-answers', { count: 3, correctCount: 2 },
      );
      const correct = submitted.filter((s) => s.isCorrect).map((s) => s.studentIdNumber);
      const wrong = submitted.filter((s) => !s.isCorrect).map((s) => s.studentIdNumber);

      // Stale stays visible until the replay completes.
      await realExpect(page.getByTestId('leaderboard-stale')).toBeVisible({ timeout: 30_000 });

      await realStack.control('quiz.device-sync', { available: true });
      await realExpect(page.getByTestId('leaderboard-stale')).toHaveCount(0, { timeout: 30_000 });

      // Exactly one row per student — no duplicate row from the replay.
      for (const id of submitted.map((s) => s.studentIdNumber)) {
        await realExpect(page.getByTestId(`leaderboard-row-${id}`)).toHaveCount(1, { timeout: 20_000 });
      }
      realExpect(await page.locator('[data-testid^="leaderboard-row-"]').count()).toBe(3);

      // Dense ranking (INV-LB-2): the two correct students share rank 1 (🥇),
      // the incorrect one is rank 2 (🥈) — the DM-10 rule applied to D's answers.
      for (const id of correct) {
        await realExpect(page.getByTestId(`leaderboard-row-${id}`).locator('.us-lb__rank')).toHaveText('🥇');
      }
      await realExpect(page.getByTestId(`leaderboard-row-${wrong[0]!}`).locator('.us-lb__rank')).toHaveText('🥈');

      // Cross-check against B's own leaderboard REST: ranks converge to D's set.
      const board = await getJson(`${realStack.coreBaseUrl}/quiz/leaderboard?sessionId=${sessionId}`, token) as {
        entries: Array<{ studentIdNumber: string; rank: number }>; stale: boolean;
      };
      realExpect(board.stale).toBe(false);
      realExpect(board.entries).toHaveLength(3);
      const rankOf = (id: string) => board.entries.find((e) => e.studentIdNumber === id)!.rank;
      realExpect(correct.map(rankOf)).toEqual([1, 1]);
      realExpect(rankOf(wrong[0]!)).toBe(2);
    },
  );
});
