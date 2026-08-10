import { expect, test } from '@playwright/test';
import { forceTransition } from './overlay-helpers.js';

const SESSION_URL = '/s/01JBQ8ZK3T7WBM5N2Q4XPRVC9D';

test.describe('S-40 Result', () => {
  test('scenario demo checklist: correct, incorrect, missed, rank updating/current, offline, session close', async ({ page }) => {
    await page.goto(SESSION_URL);
    await forceTransition(page, 'student.result.correct-current');
    await expect(page.getByText('Correct!')).toBeVisible();

    await forceTransition(page, 'student.result.incorrect-pending');
    await expect(page.getByText('Not quite')).toBeVisible();
    await expect(page.getByText('Updating…')).toBeVisible();

    await forceTransition(page, 'student.question.close-missed');
    await expect(page.getByText('No answer received')).toBeVisible();

    await forceTransition(page, 'student.result.rank-current');
    await expect(page.getByText(/^#\d+$/)).toBeVisible();
  });

  test('primary: correct renders +10, the correct option, score/current rank, then a new question returns to S-39', async ({ page }) => {
    await page.goto(SESSION_URL);
    await forceTransition(page, 'student.result.correct-current');

    await expect(page.getByText('Correct!')).toBeVisible();
    await expect(page.getByText('+10')).toBeVisible();
    await expect(page.getByText('30')).toBeVisible();
    await expect(page.getByText('#3')).toBeVisible();
    await expect(page.getByText('Waiting for the next question')).toBeVisible();

    await forceTransition(page, 'student.question.open-4');
    await expect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-39');
    await expect(page.getByText('Correct!')).toHaveCount(0);
  });

  test('failure: incorrect/pending renders own vs correct answers with "Updating…", and offline preserves it', async ({ page }) => {
    await page.goto(SESSION_URL);
    await forceTransition(page, 'student.result.incorrect-pending');
    await expect(page.getByText('Not quite')).toBeVisible();
    await expect(page.getByText('Updating…')).toBeVisible();
    await expect(page.getByText('Your answer')).toBeVisible();
    await expect(page.getByText('Correct answer')).toBeVisible();

    await forceTransition(page, 'student.connection.offline');
    await expect(page.getByRole('status')).toContainText(/offline|reconnecting/i);
    await expect(page.getByText('Not quite')).toBeVisible();
    await expect(page.getByText('Updating…')).toBeVisible();
  });

  test('a rank-current transition updates only the rank, not the score', async ({ page }) => {
    await page.goto(SESSION_URL);
    await forceTransition(page, 'student.result.incorrect-pending');
    await expect(page.getByText('Updating…')).toBeVisible();
    await expect(page.getByText('20')).toBeVisible();

    await forceTransition(page, 'student.result.rank-current');
    await expect(page.getByText('#3')).toBeVisible();
    await expect(page.getByText('20')).toBeVisible();
  });

  test('session close supersedes a visible result with S-41', async ({ page }) => {
    await page.goto(SESSION_URL);
    await forceTransition(page, 'student.result.correct-current');
    await expect(page.getByText('Correct!')).toBeVisible();

    await forceTransition(page, 'student.session.close-participated');
    await expect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-41');
  });
});
