import { expect, test } from '@playwright/test';
import { chooseScenario, forceTransition, openScenarioOverlay } from './overlay-helpers.js';

test.describe('S-37 Join', () => {
  test('scenario demo checklist', async ({ page }) => {
    // resolving: student-quiz-happy's restDelayMs keeps the skeleton visible.
    await page.goto('/j');
    await chooseScenario(page, 'student-quiz-happy');
    await page.getByRole('textbox', { name: /quiz code/i }).fill('ABC123');
    await page.getByRole('button', { name: 'Join' }).click();
    await expect(page.getByTestId('join-skeleton')).toBeVisible();
    // open, new participant -> replace-route to register (S-38).
    await expect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-38');
  });

  test('primary: open + new participant replace-routes to registration', async ({ page }) => {
    await page.goto('/j');
    await page.getByRole('textbox', { name: /quiz code/i }).fill('ABC123');
    await page.getByRole('button', { name: 'Join' }).click();
    await expect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-38');
    expect(page.url()).toContain('/j/ABC123/register');
  });

  test('primary: manual entry normalizes a lowercase code', async ({ page }) => {
    await page.goto('/j');
    await page.getByRole('textbox', { name: /quiz code/i }).fill('abc123');
    await page.getByRole('button', { name: 'Join' }).click();
    await expect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-38');
    expect(page.url()).toContain('/j/abc123/register');
  });

  test('open + returning participant replace-routes straight to the session', async ({ page }) => {
    await page.goto('/j');
    await chooseScenario(page, 'student-quiz-returning');
    await page.getByRole('textbox', { name: /quiz code/i }).fill('ABC123');
    await page.getByRole('button', { name: 'Join' }).click();
    await expect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-39');
    expect(page.url()).toContain('/s/01JBQ8ZK3T7WBM5N2Q4XPRVC9D');
  });

  test('closed session replace-routes to the terminal S-41 screen', async ({ page }) => {
    await page.goto('/j');
    await chooseScenario(page, 'student-quiz-closed');
    await page.getByRole('textbox', { name: /quiz code/i }).fill('ABC123');
    await page.getByRole('button', { name: 'Join' }).click();
    await expect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-41');
  });

  test('session not found stays on S-37, editable, with a named error', async ({ page }) => {
    await page.goto('/j');
    await page.getByRole('textbox', { name: /quiz code/i }).fill('INVALID');
    await page.getByRole('button', { name: 'Join' }).click();
    await expect(page.getByText('That quiz code is not active.')).toBeVisible();
    await expect(page.getByRole('textbox', { name: /quiz code/i })).toHaveValue('INVALID');
  });

  test('failure: unreachable resolve shows retry copy, and retrying succeeds', async ({ page }) => {
    await page.goto('/j');
    await chooseScenario(page, 'student-quiz-failures');
    await page.getByRole('textbox', { name: /quiz code/i }).fill('ABC123');
    await page.getByRole('button', { name: 'Join' }).click();
    await expect(page.getByText('Something went wrong. Try again.')).toBeVisible();
    await expect(page.getByRole('textbox', { name: /quiz code/i })).toHaveValue('ABC123');

    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-38');
  });

  test('offline retains the code and disables Join; restore permits a retry', async ({ page }) => {
    await page.goto('/j');
    await page.getByRole('textbox', { name: /quiz code/i }).fill('ABC123');

    await forceTransition(page, 'student.connection.offline');
    await expect(page.getByRole('status')).toContainText(/offline|reconnecting/i);
    await expect(page.getByRole('button', { name: 'Join' })).toBeDisabled();
    await expect(page.getByRole('textbox', { name: /quiz code/i })).toHaveValue('ABC123');

    await forceTransition(page, 'student.connection.restore');
    await expect(page.getByRole('button', { name: 'Join' })).toBeEnabled({ timeout: 5_000 });
    await page.getByRole('button', { name: 'Join' }).click();
    await expect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-38');
  });
});

test('S-37 overlay reachability sanity', async ({ page }) => {
  await page.goto('/j');
  await openScenarioOverlay(page);
  await expect(page.getByLabel('student-quiz-happy')).toBeVisible();
});
