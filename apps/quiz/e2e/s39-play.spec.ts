import { expect, test } from '@playwright/test';
import { chooseScenario, forceTransition } from './overlay-helpers.js';

const SESSION_URL = '/s/01JBQ8ZK3T7WBM5N2Q4XPRVC9D';

test.describe('S-39 Play', () => {
  test('scenario demo checklist: waiting, answerable option counts, and no timer/confirm dialog', async ({ page }) => {
    await page.goto(SESSION_URL);
    await forceTransition(page, 'student.question.none');
    await expect(page.getByText(/Waiting for your lecturer/)).toBeVisible();

    await forceTransition(page, 'student.question.open-2');
    await expect(page.locator('.quiz-answer')).toHaveCount(2);
    await forceTransition(page, 'student.question.open-3');
    await expect(page.locator('.quiz-answer')).toHaveCount(3);
    await forceTransition(page, 'student.question.open-4');
    await expect(page.locator('.quiz-answer')).toHaveCount(4);

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText(/[0-9]+:[0-9]{2}/)).toHaveCount(0);
  });

  test('primary: a single tap optimistically locks, the accepted reply keeps it locked, then a result supersedes S-39', async ({ page }) => {
    await page.goto(SESSION_URL);
    const first = page.locator('.quiz-answer').first();
    await first.click();
    await expect(first).toHaveAttribute('data-state', 'submitting');
    await expect(first).toHaveAttribute('data-state', 'locked', { timeout: 5_000 });
    await expect(first).toBeDisabled();

    await forceTransition(page, 'student.result.correct-current');
    await expect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-40');
  });

  test('already-accepted reconciles to the server-stored option and locks out further taps', async ({ page }) => {
    await page.goto(SESSION_URL);
    await chooseScenario(page, 'student-quiz-returning');
    const options = page.locator('.quiz-answer');
    // storedOptionId is option B (index 1) — the snapshot arrives already
    // reconciled, so every option (including the stored one) is inert.
    await expect(options.nth(1)).toHaveAttribute('data-state', 'locked', { timeout: 5_000 });
    await expect(options.nth(0)).toHaveAttribute('data-state', 'idle');
    await expect(options.nth(0)).toBeDisabled();
    await expect(options.nth(1)).toBeDisabled();
  });

  test('failure: a late answer renders the explicit refusal, not accepted copy', async ({ page }) => {
    await page.goto(SESSION_URL);
    await chooseScenario(page, 'student-quiz-late-answer');
    await page.locator('.quiz-answer').first().click();
    await expect(page.getByText('Question closed before your answer arrived.')).toBeVisible();
    await expect(page.getByText(/accepted/i)).toHaveCount(0);
  });

  test('a lost reply returns to answerable with retry copy; retrying locks the stored answer', async ({ page }) => {
    await page.goto(SESSION_URL);
    await chooseScenario(page, 'student-quiz-failures');
    const first = page.locator('.quiz-answer').first();
    await first.click();
    await expect(page.getByText(/try again/i)).toBeVisible();
    await expect(first).toBeEnabled();

    await first.click();
    await expect(first).toHaveAttribute('data-state', 'locked', { timeout: 5_000 });
  });

  test('missed: forcing a close-missed transition delegates to S-40, never incorrect', async ({ page }) => {
    await page.goto(SESSION_URL);
    await forceTransition(page, 'student.question.close-missed');
    await expect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-40');
    await expect(page.getByText('No answer received')).toBeVisible();
  });

  test('offline retains and dims the question; reconnect restores it with no stale flash', async ({ page }) => {
    await page.goto(SESSION_URL);
    await forceTransition(page, 'student.connection.offline');
    const options = page.locator('.quiz-answer');
    await expect(options.first()).toBeDisabled();

    await forceTransition(page, 'student.connection.restore');
    await expect(options.first()).toBeEnabled({ timeout: 5_000 });
    await expect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-39');
  });

  test('a closed session supersedes the live screen with S-41', async ({ page }) => {
    await page.goto(SESSION_URL);
    await forceTransition(page, 'student.session.close-participated');
    await expect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-41');
  });
});
