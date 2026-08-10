import { expect, test } from '@playwright/test';
import { chooseScenario, forceTransition } from './overlay-helpers.js';

const SESSION_URL = '/s/01JBQ8ZK3T7WBM5N2Q4XPRVC9D';

test.describe('S-41 Session ended', () => {
  test('scenario demo checklist: participated, never answered, offline-close, direct not-found', async ({ page }) => {
    await page.goto(SESSION_URL);
    await forceTransition(page, 'student.session.close-participated');
    await expect(page.getByRole('heading', { name: 'Quiz ended' })).toBeVisible();
    await expect(page.getByText('You can close this tab now.')).toBeVisible();

    await forceTransition(page, 'student.session.close-none');
    await expect(page.getByText(/didn.t answer any questions/i)).toBeVisible();
  });

  test('primary: participated close shows final score/rank/answered count, close-tab copy, and no controls', async ({ page }) => {
    await page.goto(SESSION_URL);
    await forceTransition(page, 'student.session.close-participated');

    await expect(page.getByRole('heading', { name: 'Quiz ended' })).toBeVisible();
    await expect(page.getByText('30')).toBeVisible(); // final score
    await expect(page.getByText('#3')).toBeVisible(); // final own rank
    await expect(page.getByText('3', { exact: true })).toBeVisible(); // answered count
    await expect(page.getByText('You can close this tab now.')).toBeVisible();
    await expect(page.locator('main button')).toHaveCount(0);
    await expect(page.getByRole('link')).toHaveCount(0);
  });

  test('failure: an offline-close reconnect lands directly on the terminal summary with a "Reconnected" announcement', async ({ page }) => {
    await page.goto(SESSION_URL);
    await forceTransition(page, 'student.connection.offline');
    await forceTransition(page, 'student.session.prepare-close-participated');
    await forceTransition(page, 'student.connection.restore');

    await expect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-41', { timeout: 15_000 });
    await expect(page.getByText('30')).toBeVisible();
    await expect(page.getByText('Reconnected.')).toBeVisible();
  });

  test('failure: a direct session-not-found link shows stale-link copy without a fabricated summary', async ({ page }) => {
    await page.goto(SESSION_URL);
    await chooseScenario(page, 'student-quiz-session-not-found');

    await expect(page.getByRole('heading', { name: 'This quiz link is no longer valid' })).toBeVisible();
    await expect(page.getByText('Final score')).toHaveCount(0);
    await expect(page.getByText(/didn.t answer/i)).toHaveCount(0);
  });
});
