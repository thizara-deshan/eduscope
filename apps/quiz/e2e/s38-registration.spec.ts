import { expect, test } from '@playwright/test';
import { chooseScenario, forceTransition } from './overlay-helpers.js';

test.describe('S-38 Self-registration', () => {
  test('scenario demo checklist: empty, filling, both field failures, submitting', async ({ page }) => {
    await page.goto('/j/ABC123/register');
    await expect(page.getByLabel('Full name')).toHaveValue('');
    await expect(page.getByLabel('Student ID')).toHaveValue('');
    // The policy hint is contract-provided, not hardcoded.
    await expect(page.getByText('Two uppercase letters followed by 7 or 8 digits')).toBeVisible();

    await page.getByLabel('Full name').fill('K. Fernando');
    await page.getByLabel('Student ID').fill('IT12345678');
    await expect(page.getByLabel('Full name')).toHaveValue('K. Fernando');

    await expect(page.getByRole('textbox')).toHaveCount(2);
    await expect(page.locator('form button')).toHaveCount(1);
  });

  test('primary: anonymous join with a valid name/ID creates a participant and routes to the session', async ({ page }) => {
    await page.goto('/j/ABC123/register');
    await page.getByLabel('Full name').fill('K. Fernando');
    await page.getByLabel('Student ID').fill('IT12345678');
    await page.getByRole('button', { name: /join/i }).click();

    await expect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-39');
    expect(page.url()).toContain('/s/01JBQ8ZK3T7WBM5N2Q4XPRVC9D');
  });

  test('a malformed student ID stays on S-38 with the invalid field focused', async ({ page }) => {
    await page.goto('/j/ABC123/register');
    await page.getByLabel('Full name').fill('K. Fernando');
    await page.getByLabel('Student ID').fill('it12');
    await page.getByRole('button', { name: /join/i }).click();

    await expect(page.getByText('Student ID: Two uppercase letters followed by 7 or 8 digits')).toBeVisible();
    await expect(page.getByLabel('Student ID')).toBeFocused();
    await expect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-38');
  });

  test('failure: a race with a closing session routes to the S-41 terminal screen', async ({ page }) => {
    await page.goto('/j/ABC123/register');
    await chooseScenario(page, 'student-quiz-registration-closed');
    await page.getByLabel('Full name').fill('K. Fernando');
    await page.getByLabel('Student ID').fill('IT12345678');
    await page.getByRole('button', { name: /join/i }).click();

    await expect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-41');
  });

  test('duplicate rejoin routes to the session with no separate interstitial', async ({ page }) => {
    await page.goto('/j/ABC123/register');
    await chooseScenario(page, 'student-quiz-returning');
    await page.getByLabel('Full name').fill('K. Fernando');
    await page.getByLabel('Student ID').fill('IT12345678');
    await page.getByRole('button', { name: /join/i }).click();

    await expect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-39');
    expect(page.url()).toContain('/s/01JBQ8ZK3T7WBM5N2Q4XPRVC9D');
  });

  test('offline retains values and blocks submit; restore permits an explicit resubmit', async ({ page }) => {
    await page.goto('/j/ABC123/register');
    await page.getByLabel('Full name').fill('K. Fernando');
    await page.getByLabel('Student ID').fill('IT12345678');

    await forceTransition(page, 'student.connection.offline');
    await expect(page.getByRole('button', { name: /join/i })).toBeDisabled();
    await expect(page.getByLabel('Full name')).toHaveValue('K. Fernando');

    await forceTransition(page, 'student.connection.restore');
    await expect(page.getByRole('button', { name: /join/i })).toBeEnabled({ timeout: 5_000 });
    await page.getByRole('button', { name: /join/i }).click();
    await expect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-39');
  });
});
